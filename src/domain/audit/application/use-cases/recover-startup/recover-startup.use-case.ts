import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AuditLogPort } from '@domain/audit/application/ports/audit-log.port';
import { FallbackWriterPort } from '@domain/audit/application/ports/fallback-writer.port';
import { ConfigLoaderPort } from '@domain/config/application/ports/config-loader.port';
import { BackupLockPort } from '@domain/backup/application/ports/backup-lock.port';
import { RemoteStorageFactory } from '@domain/backup/application/ports/remote-storage-factory.port';
import { ClockPort } from '@common/clock/clock.port';
import { BackupResult } from '@domain/backup/domain/backup-result.model';
import { BackupStatus } from '@domain/backup/domain/value-objects/backup-status.enum';
import {
  AUDIT_LOG_PORT,
  FALLBACK_WRITER_PORT,
  CONFIG_LOADER_PORT,
  BACKUP_LOCK_PORT,
  REMOTE_STORAGE_FACTORY,
  CLOCK_PORT,
} from '@common/di/injection-tokens';

@Injectable()
export class RecoverStartupUseCase implements OnModuleInit {
  private readonly logger = new Logger(RecoverStartupUseCase.name);

  constructor(
    @Inject(AUDIT_LOG_PORT) private readonly auditLog: AuditLogPort,
    @Inject(FALLBACK_WRITER_PORT) private readonly fallbackWriter: FallbackWriterPort,
    @Inject(CONFIG_LOADER_PORT) private readonly configLoader: ConfigLoaderPort,
    @Inject(BACKUP_LOCK_PORT) private readonly backupLock: BackupLockPort,
    @Inject(REMOTE_STORAGE_FACTORY) private readonly storageFactory: RemoteStorageFactory,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
  ) {}

  async onModuleInit(): Promise<void> {
    this.logger.log('Starting recovery checks...');

    const orphanCount = await this.markOrphanedRuns();
    const lockCount = await this.cleanStaleLocks();
    const unlockCount = await this.unlockResticRepos();
    const replayCount = await this.replayFallbackEntries();

    this.logger.log(
      `Recovery complete: ${orphanCount} orphaned runs marked, ` +
        `${lockCount} stale locks cleaned, ${unlockCount} restic repos unlocked, ` +
        `${replayCount} fallback entries replayed`,
    );
  }

  private async markOrphanedRuns(): Promise<number> {
    try {
      const orphanedRuns = await this.auditLog.findOrphaned();
      const now = this.clock.now();

      for (const orphan of orphanedRuns) {
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

      return orphanedRuns.length;
    } catch (error) {
      this.logger.error('Failed to mark orphaned runs', error);
      return 0;
    }
  }

  private async cleanStaleLocks(): Promise<number> {
    let cleaned = 0;

    try {
      const projects = this.configLoader.loadAll();

      for (const project of projects) {
        try {
          await this.backupLock.release(project.name);
          cleaned++;
        } catch {
          // Lock did not exist — nothing to clean
        }
      }

      if (cleaned > 0) {
        this.logger.warn(`Released ${cleaned} stale lock(s)`);
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
}
