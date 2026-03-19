import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

import { BackupLockPort } from '@domain/backup/application/ports/backup-lock.port';
import { DumpEncryptorPort } from '@domain/backup/application/ports/dump-encryptor.port';
import { HookExecutorPort } from '@domain/backup/application/ports/hook-executor.port';
import { LocalCleanupPort } from '@domain/backup/application/ports/local-cleanup.port';
import { RemoteStoragePort } from '@domain/backup/application/ports/remote-storage.port';
import { AuditLogPort } from '@domain/audit/application/ports/audit-log.port';
import { FallbackWriterPort } from '@domain/audit/application/ports/fallback-writer.port';
import { NotifierPort } from '@domain/notification/application/ports/notifier.port';
import { ConfigLoaderPort } from '@domain/config/application/ports/config-loader.port';
import { ClockPort } from '@common/clock/clock.port';
import { ProjectConfig } from '@domain/config/domain/project-config.model';
import { BackupResult } from '@domain/backup/domain/backup-result.model';
import { BackupStage } from '@domain/backup/domain/value-objects/backup-stage.enum';
import { BackupStatus } from '@domain/backup/domain/value-objects/backup-status.enum';
import { BackupStageError } from '@domain/backup/domain/backup-stage-error';
import { CleanupResult } from '@domain/backup/domain/value-objects/cleanup-result.model';
import { DumpResult } from '@domain/backup/domain/value-objects/dump-result.model';
import { PruneResult } from '@domain/backup/domain/value-objects/prune-result.model';
import { SyncResult } from '@domain/backup/domain/value-objects/sync-result.model';
import { evaluateRetry } from '@domain/backup/domain/policies/retry.policy';
import { DumperRegistry } from '@domain/backup/application/registries/dumper.registry';
import { NotifierRegistry } from '@domain/backup/application/registries/notifier.registry';

import {
  CONFIG_LOADER_PORT,
  DUMPER_REGISTRY,
  NOTIFIER_REGISTRY,
  BACKUP_LOCK_PORT,
  AUDIT_LOG_PORT,
  FALLBACK_WRITER_PORT,
  CLOCK_PORT,
  DUMP_ENCRYPTOR_PORT,
  HOOK_EXECUTOR_PORT,
  LOCAL_CLEANUP_PORT,
  REMOTE_STORAGE_FACTORY,
} from '@common/di/injection-tokens';
import { safeExecFile } from '@common/helpers/child-process.util';

import { RunBackupCommand } from './run-backup.command';

export interface RemoteStorageFactory {
  createStorage(config: ProjectConfig): RemoteStoragePort;
}

export interface DryRunCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly message: string;
}

export interface DryRunReport {
  readonly projectName: string;
  readonly checks: DryRunCheck[];
  readonly allPassed: boolean;
}

@Injectable()
export class RunBackupUseCase {
  private readonly logger = new Logger(RunBackupUseCase.name);
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly baseDir: string;

  constructor(
    @Inject(CONFIG_LOADER_PORT) private readonly configLoader: ConfigLoaderPort,
    @Inject(DUMPER_REGISTRY) private readonly dumperRegistry: DumperRegistry,
    @Inject(NOTIFIER_REGISTRY) private readonly notifierRegistry: NotifierRegistry,
    @Inject(BACKUP_LOCK_PORT) private readonly backupLock: BackupLockPort,
    @Inject(AUDIT_LOG_PORT) private readonly auditLog: AuditLogPort,
    @Inject(FALLBACK_WRITER_PORT) private readonly fallbackWriter: FallbackWriterPort,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(DUMP_ENCRYPTOR_PORT) private readonly encryptor: DumpEncryptorPort,
    @Inject(HOOK_EXECUTOR_PORT) private readonly hookExecutor: HookExecutorPort,
    @Inject(LOCAL_CLEANUP_PORT) private readonly localCleanup: LocalCleanupPort,
    @Inject(REMOTE_STORAGE_FACTORY) private readonly storageFactory: RemoteStorageFactory,
    configService: ConfigService,
  ) {
    this.maxRetries = configService.get<number>('BACKUP_RETRY_COUNT', 3);
    this.baseDelayMs = configService.get<number>('BACKUP_RETRY_DELAY_MS', 5000);
    this.baseDir = configService.get<string>('BACKUP_BASE_DIR', '/data/backups');
  }

  async execute(command: RunBackupCommand): Promise<BackupResult[]> {
    if (command.isAll) {
      return this.runAllBackups();
    }

    const projectName = command.projectName;
    if (!projectName) {
      throw new Error('Project name is required when not using --all');
    }

    if (command.isDryRun) {
      const report = await this.executeDryRun(projectName);
      const now = this.clock.now();
      const result = new BackupResult({
        runId: 'dry-run',
        projectName,
        status: report.allPassed ? BackupStatus.Success : BackupStatus.Failed,
        currentStage: BackupStage.NotifyResult,
        startedAt: now,
        completedAt: now,
        dumpResult: null,
        syncResult: null,
        pruneResult: null,
        cleanupResult: null,
        encrypted: false,
        verified: false,
        snapshotMode: 'combined',
        errorStage: null,
        errorMessage: report.allPassed ? null : report.checks.filter((c) => !c.passed).map((c) => c.message).join('; '),
        retryCount: 0,
        durationMs: 0,
      });
      return [result];
    }

    const acquired = await this.backupLock.acquire(projectName);
    if (!acquired) {
      throw new Error(`Backup already in progress for ${projectName}`);
    }

    try {
      const config = this.configLoader.getProject(projectName);
      const result = await this.executeBackup(config);
      return [result];
    } finally {
      await this.backupLock.release(projectName);
    }
  }

  async getDryRunReport(projectName: string): Promise<DryRunReport> {
    return this.executeDryRun(projectName);
  }

  private async runAllBackups(): Promise<BackupResult[]> {
    const projects = this.configLoader.loadAll().filter((project) => project.enabled);
    const results: BackupResult[] = [];

    for (const project of projects) {
      try {
        const acquired = await this.backupLock.acquire(project.name);
        if (!acquired) {
          this.logger.warn(`Backup already in progress for ${project.name}, skipping`);
          results.push(this.buildFailureResult(project.name, new Error('Backup already in progress')));
          continue;
        }
        try {
          const result = await this.executeBackup(project);
          results.push(result);
        } finally {
          await this.backupLock.release(project.name);
        }
      } catch (error) {
        this.logger.error(`Backup failed for ${project.name}: ${(error as Error).message}`);
        results.push(this.buildFailureResult(project.name, error as Error));
      }
    }

    return results;
  }

  private async executeDryRun(projectName: string): Promise<DryRunReport> {
    const checks: DryRunCheck[] = [];

    let config: ProjectConfig;
    try {
      config = this.configLoader.getProject(projectName);
      checks.push({ name: 'Config loaded', passed: true, message: `Project "${projectName}" configuration is valid` });
    } catch (error) {
      checks.push({ name: 'Config loaded', passed: false, message: `Failed to load config: ${(error as Error).message}` });
      return { projectName, checks, allPassed: false };
    }

    try {
      this.dumperRegistry.resolve(config.database.type);
      checks.push({ name: 'Database dumper', passed: true, message: `Adapter found for database type: ${config.database.type}` });
    } catch (error) {
      checks.push({ name: 'Database dumper', passed: false, message: (error as Error).message });
    }

    try {
      const notificationType = config.notification?.type ?? 'slack';
      this.notifierRegistry.resolve(notificationType);
      checks.push({ name: 'Notifier', passed: true, message: `Adapter found for notification type: ${notificationType}` });
    } catch (error) {
      checks.push({ name: 'Notifier', passed: false, message: (error as Error).message });
    }

    try {
      const storage = this.storageFactory.createStorage(config);
      await storage.listSnapshots();
      checks.push({ name: 'Restic repo', passed: true, message: `Repository accessible at ${config.restic.repositoryPath}` });
    } catch (error) {
      checks.push({ name: 'Restic repo', passed: false, message: `Repository unreachable: ${(error as Error).message}` });
    }

    try {
      const outputDir = path.join(this.baseDir, config.name);
      const diskCheckDir = fs.existsSync(outputDir) ? outputDir : this.baseDir;
      const stats = fs.statfsSync(diskCheckDir);
      const freeGb = (stats.bsize * stats.bavail) / (1024 * 1024 * 1024);
      const minFreeGb = 5;
      if (freeGb >= minFreeGb) {
        checks.push({ name: 'Disk space', passed: true, message: `${freeGb.toFixed(1)} GB free (minimum: ${minFreeGb} GB)` });
      } else {
        checks.push({ name: 'Disk space', passed: false, message: `Only ${freeGb.toFixed(1)} GB free (minimum: ${minFreeGb} GB)` });
      }
    } catch (error) {
      checks.push({ name: 'Disk space', passed: false, message: `Unable to check disk space: ${(error as Error).message}` });
    }

    if (config.hasEncryption()) {
      try {
        const { stdout } = await safeExecFile('gpg', ['--list-keys', config.encryption!.recipient], { timeout: 10000 });
        if (stdout.length > 0) {
          checks.push({ name: 'GPG key', passed: true, message: `Key found for recipient: ${config.encryption!.recipient}` });
        } else {
          checks.push({ name: 'GPG key', passed: false, message: `No key found for recipient: ${config.encryption!.recipient}` });
        }
      } catch (error) {
        checks.push({ name: 'GPG key', passed: false, message: `GPG key not found: ${(error as Error).message}` });
      }
    }

    if (config.hasAssets()) {
      const missingPaths = config.assets.paths.filter((p) => !fs.existsSync(p));
      if (missingPaths.length === 0) {
        checks.push({ name: 'Asset paths', passed: true, message: `All ${config.assets.paths.length} asset path(s) exist` });
      } else {
        checks.push({ name: 'Asset paths', passed: false, message: `Missing paths: ${missingPaths.join(', ')}` });
      }
    }

    const allPassed = checks.every((c) => c.passed);
    return { projectName, checks, allPassed };
  }

  private async executeBackup(config: ProjectConfig): Promise<BackupResult> {
    const startedAt = this.clock.now();
    const timestamp = this.clock.timestamp();

    const dumper = this.dumperRegistry.resolve(config.database.type);
    const notifier = this.resolveNotifier(config);
    const storage = this.storageFactory.createStorage(config);
    const outputDir = path.join(this.baseDir, config.name);
    const runId = await this.auditLog.startRun(config.name);

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    if (config.hasTimeout()) {
      timeoutHandle = setTimeout(
        () => {
          notifier
            .notifyWarning(config.name, `Backup exceeded ${config.timeoutMinutes} minute timeout`)
            .catch((warningError) => {
              this.logger.error(`Timeout warning notification failed: ${warningError}`);
            });
        },
        config.timeoutMinutes! * 60 * 1000,
      );
    }

    let dumpResult: DumpResult | null = null;
    let syncResult: SyncResult | null = null;
    let pruneResult: PruneResult | null = null;
    let cleanupResult: CleanupResult | null = null;
    let encrypted = false;
    let verified = false;
    let totalRetries = 0;
    let errorStage: BackupStage | null = null;
    let errorMessage: string | null = null;
    let status = BackupStatus.Success;

    try {
      await this.executeStage(BackupStage.NotifyStarted, runId, async () => {
        await notifier.notifyStarted(config.name);
      });

      if (config.hasHooks() && config.hooks!.preBackup) {
        await this.executeStage(BackupStage.PreHook, runId, async () => {
          await this.hookExecutor.execute(config.hooks!.preBackup!);
        });
      }

      dumpResult = await this.executeRetryableStage<DumpResult>(
        BackupStage.Dump,
        runId,
        () => dumper.dump(outputDir, config.name, timestamp),
        (retries) => { totalRetries += retries; },
      );

      if (config.hasVerification()) {
        await this.executeRetryableStage<boolean>(
          BackupStage.Verify,
          runId,
          () => dumper.verify(dumpResult!.filePath),
          (retries) => { totalRetries += retries; },
        );
        verified = true;
      }

      if (config.hasEncryption()) {
        const encryptedPath = await this.executeRetryableStage<string>(
          BackupStage.Encrypt,
          runId,
          () => this.encryptor.encrypt(dumpResult!.filePath),
          (retries) => { totalRetries += retries; },
        );
        dumpResult = new DumpResult(encryptedPath, dumpResult!.sizeBytes, dumpResult!.durationMs);
        encrypted = true;
      }

      const syncPaths = this.buildSyncPaths(dumpResult!.filePath, config, notifier);
      syncResult = await this.executeRetryableStage<SyncResult>(
        BackupStage.Sync,
        runId,
        () =>
          storage.sync(syncPaths, {
            tags: this.buildTags(config, timestamp),
            snapshotMode: config.restic.snapshotMode,
          }),
        (retries) => { totalRetries += retries; },
      );

      pruneResult = await this.executeRetryableStage<PruneResult>(
        BackupStage.Prune,
        runId,
        () => storage.prune(config.retention),
        (retries) => { totalRetries += retries; },
      );

      cleanupResult = await this.executeRetryableStage<CleanupResult>(
        BackupStage.Cleanup,
        runId,
        () => this.localCleanup.cleanup(outputDir, config.retention.localDays),
        (retries) => { totalRetries += retries; },
      );

      if (config.hasHooks() && config.hooks!.postBackup) {
        await this.executeStage(BackupStage.PostHook, runId, async () => {
          await this.hookExecutor.execute(config.hooks!.postBackup!);
        });
      }
    } catch (error) {
      status = BackupStatus.Failed;
      if (error instanceof BackupStageError) {
        errorStage = error.stage;
        errorMessage = error.message;
      } else {
        errorStage = null;
        errorMessage = (error as Error).message;
      }
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }

    const completedAt = this.clock.now();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    const result = new BackupResult({
      runId,
      projectName: config.name,
      status,
      currentStage:
        status === BackupStatus.Success
          ? BackupStage.NotifyResult
          : errorStage ?? BackupStage.NotifyResult,
      startedAt,
      completedAt,
      dumpResult,
      syncResult,
      pruneResult,
      cleanupResult,
      encrypted,
      verified,
      snapshotMode: config.restic.snapshotMode,
      errorStage,
      errorMessage,
      retryCount: totalRetries,
      durationMs,
    });

    await this.finalizeAudit(runId, result);
    await this.finalizeNotification(notifier, config.name, result);

    return result;
  }

  private async executeStage(
    stage: BackupStage,
    runId: string,
    operation: () => Promise<void>,
  ): Promise<void> {
    await this.auditLog.trackProgress(runId, stage);
    try {
      await operation();
    } catch (error) {
      throw new BackupStageError(stage, error as Error, false);
    }
  }

  private async executeRetryableStage<T>(
    stage: BackupStage,
    runId: string,
    operation: () => Promise<T>,
    onRetryCount: (retries: number) => void,
  ): Promise<T> {
    await this.auditLog.trackProgress(runId, stage);

    let attempt = 0;

    while (true) {
      try {
        const result = await operation();
        onRetryCount(attempt);
        return result;
      } catch (error) {
        attempt++;
        const decision = evaluateRetry(stage, attempt, this.maxRetries, this.baseDelayMs);

        if (!decision.shouldRetry) {
          onRetryCount(attempt);
          throw new BackupStageError(stage, error as Error, true);
        }

        this.logger.warn(
          `Stage ${stage} failed (attempt ${attempt}/${this.maxRetries}), ` +
            `retrying in ${decision.delayMs}ms: ${(error as Error).message}`,
        );

        await this.delay(decision.delayMs);
      }
    }
  }

  private async finalizeAudit(runId: string, result: BackupResult): Promise<void> {
    try {
      await this.auditLog.finishRun(runId, result);
    } catch (error) {
      this.logger.error(`Audit finalization failed, writing to fallback: ${error}`);
      await this.fallbackWriter.writeAuditFallback(result);
    }
  }

  private async finalizeNotification(
    notifier: NotifierPort,
    projectName: string,
    result: BackupResult,
  ): Promise<void> {
    try {
      if (result.status === BackupStatus.Success) {
        await notifier.notifySuccess(result);
      } else {
        await notifier.notifyFailure(
          projectName,
          new BackupStageError(
            result.errorStage ?? BackupStage.NotifyResult,
            new Error(result.errorMessage ?? 'Unknown error'),
            false,
          ),
        );
      }
    } catch (error) {
      this.logger.error(`Notification failed, writing to fallback: ${error}`);
      await this.fallbackWriter.writeNotificationFallback(
        result.status === BackupStatus.Success ? 'success' : 'failure',
        { projectName, result },
      );
    }
  }

  private resolveNotifier(config: ProjectConfig): NotifierPort {
    const notificationType = config.notification?.type ?? 'slack';
    return this.notifierRegistry.resolve(notificationType);
  }

  private buildSyncPaths(
    dumpFilePath: string,
    config: ProjectConfig,
    notifier: NotifierPort,
  ): string[] {
    const syncPaths = [dumpFilePath];

    if (config.hasAssets()) {
      for (const assetPath of config.assets.paths) {
        if (fs.existsSync(assetPath)) {
          syncPaths.push(assetPath);
        } else {
          this.logger.warn(`Asset path not found, skipping: ${assetPath}`);
          notifier
            .notifyWarning(config.name, `Missing asset path: ${assetPath}`)
            .catch((warningError) => {
              this.logger.error(`Warning notification failed: ${warningError}`);
            });
        }
      }
    }

    return syncPaths;
  }

  private buildTags(config: ProjectConfig, timestamp: string): string[] {
    return [
      `project:${config.name}`,
      `db:${config.database.type}`,
      `timestamp:${timestamp}`,
    ];
  }

  private buildFailureResult(projectName: string, error: Error): BackupResult {
    const now = this.clock.now();
    return new BackupResult({
      runId: 'failed',
      projectName,
      status: BackupStatus.Failed,
      currentStage: BackupStage.NotifyResult,
      startedAt: now,
      completedAt: now,
      dumpResult: null,
      syncResult: null,
      pruneResult: null,
      cleanupResult: null,
      encrypted: false,
      verified: false,
      snapshotMode: 'combined',
      errorStage: null,
      errorMessage: error.message,
      retryCount: 0,
      durationMs: 0,
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
