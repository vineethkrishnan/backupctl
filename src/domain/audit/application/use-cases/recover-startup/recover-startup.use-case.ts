import * as path from 'path';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditLogPort } from '@domain/audit/application/ports/audit-log.port';
import { FallbackWriterPort } from '@domain/audit/application/ports/fallback-writer.port';
import { ConfigLoaderPort } from '@domain/config/application/ports/config-loader.port';
import { BackupLockPort } from '@domain/backup/application/ports/backup-lock.port';
import { RemoteStorageFactory } from '@domain/backup/application/ports/remote-storage-factory.port';
import { GpgKeyManagerPort } from '@domain/backup/application/ports/gpg-key-manager.port';
import { ClockPort } from '@common/clock/clock.port';
import { FileSystemPort } from '@common/filesystem/filesystem.port';
import { BackupResult } from '@domain/backup/domain/backup-result.model';
import { BackupStatus } from '@domain/backup/domain/value-objects/backup-status.enum';
import {
  AUDIT_LOG_PORT,
  FALLBACK_WRITER_PORT,
  CONFIG_LOADER_PORT,
  BACKUP_LOCK_PORT,
  REMOTE_STORAGE_FACTORY,
  CLOCK_PORT,
  FILESYSTEM_PORT,
  GPG_KEY_MANAGER_PORT,
} from '@common/di/injection-tokens';

const DUMP_FILE_EXTENSIONS = ['.sql', '.sql.gz', '.sql.bz2', '.archive', '.gz', '.bson', '.gpg'];

@Injectable()
export class RecoverStartupUseCase implements OnModuleInit {
  private readonly logger = new Logger(RecoverStartupUseCase.name);
  private readonly baseDir: string;

  constructor(
    @Inject(AUDIT_LOG_PORT) private readonly auditLog: AuditLogPort,
    @Inject(FALLBACK_WRITER_PORT) private readonly fallbackWriter: FallbackWriterPort,
    @Inject(CONFIG_LOADER_PORT) private readonly configLoader: ConfigLoaderPort,
    @Inject(BACKUP_LOCK_PORT) private readonly backupLock: BackupLockPort,
    @Inject(REMOTE_STORAGE_FACTORY) private readonly storageFactory: RemoteStorageFactory,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(FILESYSTEM_PORT) private readonly filesystem: FileSystemPort,
    @Inject(GPG_KEY_MANAGER_PORT) private readonly gpgKeyManager: GpgKeyManagerPort,
    configService: ConfigService,
  ) {
    this.baseDir = configService.get<string>('BACKUP_BASE_DIR', '/data/backups');
    this.isCliMode = configService.get<string>('BACKUPCTL_CLI_MODE') === '1';
  }

  private readonly isCliMode: boolean;

  async onModuleInit(): Promise<void> {
    if (this.isCliMode) {
      return;
    }

    this.logger.log('Starting recovery checks...');

    const orphanResult = await this.markOrphanedRuns();
    const dumpCount = this.cleanOrphanedDumps(orphanResult.projectNames);
    const lockCount = await this.cleanStaleLocks(orphanResult.projectNames);
    const unlockCount = await this.unlockResticRepos();
    const replayCount = await this.replayFallbackEntries();
    const gpgCount = await this.importGpgKeys();

    this.logger.log(
      `Recovery complete: ${orphanResult.count} orphaned runs marked, ` +
        `${dumpCount} orphaned dumps cleaned, ` +
        `${lockCount} stale locks cleaned, ${unlockCount} restic repos unlocked, ` +
        `${replayCount} fallback entries replayed, ${gpgCount} GPG keys imported`,
    );
  }

  private async markOrphanedRuns(): Promise<{ count: number; projectNames: Set<string> }> {
    const projectNames = new Set<string>();
    try {
      const orphanedRuns = await this.auditLog.findOrphaned();
      const now = this.clock.now();

      for (const orphan of orphanedRuns) {
        projectNames.add(orphan.projectName);
        const failedResult = new BackupResult({
          ...orphan,
          status: BackupStatus.Failed,
          completedAt: now,
          errorStage: null,
          errorMessage: 'crash_recovery',
        });
        await this.auditLog.finishRun(orphan.runId, failedResult);
      }

      if (orphanedRuns.length > 0) {
        this.logger.warn(`Marked ${orphanedRuns.length} orphaned run(s) as failed`);
      }

      return { count: orphanedRuns.length, projectNames };
    } catch (error) {
      this.logger.error('Failed to mark orphaned runs', error);
      return { count: 0, projectNames };
    }
  }

  private cleanOrphanedDumps(orphanedProjectNames: Set<string>): number {
    let cleaned = 0;

    try {
      const projects = this.configLoader.loadAll();

      for (const project of projects) {
        // Only clean dumps for projects that had orphaned runs
        if (!orphanedProjectNames.has(project.name)) continue;

        const projectDir = path.join(this.baseDir, project.name);
        if (!this.filesystem.exists(projectDir)) continue;

        const files = this.filesystem.listDirectory(projectDir);
        for (const file of files) {
          const isLock = file === '.lock';
          const isDumpFile = DUMP_FILE_EXTENSIONS.some((ext) => file.endsWith(ext));
          if (isDumpFile && !isLock) {
            try {
              this.filesystem.removeFile(path.join(projectDir, file));
              cleaned++;
            } catch (error) {
              this.logger.warn(`Failed to remove orphaned dump ${file}: ${String(error)}`);
            }
          }
        }
      }

      if (cleaned > 0) {
        this.logger.warn(`Cleaned ${cleaned} orphaned dump file(s)`);
      }
    } catch (error) {
      this.logger.error('Failed to clean orphaned dumps', error);
    }

    return cleaned;
  }

  private async cleanStaleLocks(orphanedProjectNames: Set<string>): Promise<number> {
    let cleaned = 0;

    try {
      const projects = this.configLoader.loadAll();

      for (const project of projects) {
        if (!orphanedProjectNames.has(project.name)) continue;

        if (this.backupLock.isLocked(project.name)) {
          try {
            await this.backupLock.release(project.name);
            cleaned++;
          } catch {
            // Lock release failed — non-critical
          }
        }
      }

      if (cleaned > 0) {
        this.logger.warn(`Released ${cleaned} stale lock(s) for orphaned projects`);
      }
    } catch (error) {
      this.logger.error('Failed to clean stale locks', error);
    }

    return cleaned;
  }

  private async unlockResticRepos(): Promise<number> {
    let unlocked = 0;

    try {
      const enabledProjects = this.configLoader.loadAll().filter((project) => project.enabled);

      for (const project of enabledProjects) {
        try {
          const storage = this.storageFactory.create(project);
          await storage.unlock();
          unlocked++;
        } catch (error) {
          this.logger.warn(`Failed to unlock restic repo for ${project.name}`, error);
        }
      }
    } catch (error) {
      this.logger.error('Failed to unlock restic repos', error);
    }

    return unlocked;
  }

  private async replayFallbackEntries(): Promise<number> {
    let replayed = 0;
    const replayedIds: string[] = [];

    try {
      const entries = await this.fallbackWriter.readPendingEntries();

      for (const entry of entries) {
        try {
          if (entry.type === 'audit') {
            const result = entry.payload as BackupResult;
            await this.auditLog.finishRun(result.runId, result);
            replayedIds.push(entry.id);
            replayed++;
          } else if (entry.type === 'notification') {
            replayedIds.push(entry.id);
            replayed++;
          }
        } catch (error) {
          this.logger.warn(`Failed to replay fallback entry ${entry.id}`, error);
        }
      }

      if (replayedIds.length > 0) {
        await this.fallbackWriter.clearReplayed(replayedIds);
        this.logger.log(`Replayed ${replayed} fallback entry/entries`);
      }
    } catch (error) {
      this.logger.error('Failed to replay fallback entries', error);
    }

    return replayed;
  }

  private async importGpgKeys(): Promise<number> {
    try {
      const imported = await this.gpgKeyManager.importAllFromDirectory();
      if (imported.length > 0) {
        this.logger.log(`Imported ${imported.length} GPG key(s): ${imported.join(', ')}`);
      }
      return imported.length;
    } catch (error) {
      this.logger.warn(`GPG key import failed: ${String(error)}`);
      return 0;
    }
  }
}
