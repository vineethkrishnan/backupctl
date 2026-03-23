import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import { randomUUID } from 'crypto';

import { BackupLockPort } from '@domain/backup/application/ports/backup-lock.port';
import { DumpEncryptorPort } from '@domain/backup/application/ports/dump-encryptor.port';
import { GpgKeyManagerPort } from '@domain/backup/application/ports/gpg-key-manager.port';
import { HookExecutorPort } from '@domain/backup/application/ports/hook-executor.port';
import { LocalCleanupPort } from '@domain/backup/application/ports/local-cleanup.port';
import { RemoteStorageFactoryPort } from '@domain/backup/application/ports/remote-storage-factory.port';
import { HeartbeatMonitorPort } from '@domain/backup/application/ports/heartbeat-monitor.port';
import { AuditLogPort } from '@domain/audit/application/ports/audit-log.port';
import { FallbackWriterPort } from '@domain/audit/application/ports/fallback-writer.port';
import { NotifierPort } from '@domain/notification/application/ports/notifier.port';
import { ConfigLoaderPort } from '@domain/config/application/ports/config-loader.port';
import { ClockPort } from '@common/clock/clock.port';
import { FileSystemPort } from '@common/filesystem/filesystem.port';
import { ProjectConfig } from '@domain/config/domain/project-config.model';
import { BackupResult, BackupType } from '@domain/backup/domain/backup-result.model';
import { BackupStage } from '@domain/backup/domain/value-objects/backup-stage.enum';
import { BackupStatus } from '@domain/backup/domain/value-objects/backup-status.enum';
import { BackupStageError } from '@domain/backup/domain/backup-stage-error';
import { CleanupResult } from '@domain/backup/domain/value-objects/cleanup-result.model';
import { DumpResult } from '@domain/backup/domain/value-objects/dump-result.model';
import { PruneResult } from '@domain/backup/domain/value-objects/prune-result.model';
import { SyncResult } from '@domain/backup/domain/value-objects/sync-result.model';
import { evaluateRetry } from '@domain/backup/domain/policies/retry.policy';
import { DumperRegistry } from '@domain/backup/application/registries/dumper.registry';
import { NotifierRegistry } from '@domain/notification/application/registries/notifier.registry';
import { formatDuration } from '@common/helpers/format.util';

import {
  CONFIG_LOADER_PORT,
  DUMPER_REGISTRY,
  NOTIFIER_REGISTRY,
  BACKUP_LOCK_PORT,
  AUDIT_LOG_PORT,
  FALLBACK_WRITER_PORT,
  CLOCK_PORT,
  DUMP_ENCRYPTOR_PORT,
  FILESYSTEM_PORT,
  GPG_KEY_MANAGER_PORT,
  HOOK_EXECUTOR_PORT,
  LOCAL_CLEANUP_PORT,
  REMOTE_STORAGE_FACTORY,
  HEARTBEAT_MONITOR_PORT,
} from '@common/di/injection-tokens';

import { RunBackupCommand } from './run-backup.command';

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
    @Inject(REMOTE_STORAGE_FACTORY) private readonly storageFactory: RemoteStorageFactoryPort,
    @Inject(FILESYSTEM_PORT) private readonly filesystem: FileSystemPort,
    @Inject(GPG_KEY_MANAGER_PORT) private readonly gpgKeyManager: GpgKeyManagerPort,
    @Inject(HEARTBEAT_MONITOR_PORT) private readonly heartbeatMonitor: HeartbeatMonitorPort,
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
      let backupType: BackupType = 'database';
      try {
        backupType = this.resolveBackupType(this.configLoader.getProject(projectName));
      } catch {
        // Config failed to load — already captured in dry-run checks
      }
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
        backupType,
        snapshotMode: 'combined',
        errorStage: null,
        errorMessage: report.allPassed ? null : report.checks.filter((c) => !c.passed).map((c) => c.message).join('; '),
        retryCount: 0,
        durationMs: 0,
      });
      return [result];
    }

    if (command.lockHeldExternally) {
      const config = this.configLoader.getProject(projectName);
      const result = await this.executeBackup(config);
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

    if (config.hasDatabase() && config.database) {
      const dbType = config.database.type;
      if (this.dumperRegistry.has(dbType)) {
        checks.push({ name: 'Database dumper', passed: true, message: `Adapter found for database type: ${dbType}` });
      } else {
        checks.push({ name: 'Database dumper', passed: false, message: `No database dumper registered for type: ${dbType}` });
      }
    }

    if (config.notification) {
      try {
        this.notifierRegistry.resolve(config.notification.type);
        checks.push({ name: 'Notifier', passed: true, message: `Adapter found for notification type: ${config.notification.type}` });
      } catch (error) {
        checks.push({ name: 'Notifier', passed: false, message: (error as Error).message });
      }
    } else {
      checks.push({ name: 'Notifier', passed: true, message: 'Notifications disabled (no config)' });
    }

    try {
      const storage = this.storageFactory.create(config);
      await storage.listSnapshots();
      checks.push({ name: 'Restic repo', passed: true, message: `Repository accessible at ${config.restic.repositoryPath}` });
    } catch (error) {
      checks.push({ name: 'Restic repo', passed: false, message: `Repository unreachable: ${(error as Error).message}` });
    }

    try {
      const outputDir = path.join(this.baseDir, config.name);
      const diskCheckDir = this.filesystem.exists(outputDir) ? outputDir : this.baseDir;
      const freeGb = this.filesystem.diskFreeGb(diskCheckDir);
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
      const encryption = config.encryption;
      if (!encryption) throw new Error('Encryption config required');
      try {
        const hasGpgKey = await this.gpgKeyManager.hasKey(encryption.recipient);
        if (hasGpgKey) {
          checks.push({ name: 'GPG key', passed: true, message: `Key found for recipient: ${encryption.recipient}` });
        } else {
          checks.push({ name: 'GPG key', passed: false, message: `No key found for recipient: ${encryption.recipient}` });
        }
      } catch (error) {
        checks.push({ name: 'GPG key', passed: false, message: `GPG key not found: ${(error as Error).message}` });
      }
    }

    if (config.hasAssets()) {
      const missingPaths = config.assets.paths.filter((p) => !this.filesystem.exists(p));
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

    const notifier = this.resolveNotifier(config);
    const storage = this.storageFactory.create(config);
    const outputDir = path.join(this.baseDir, config.name);

    // Audit DB outage must not block backups — fall back to a local UUID
    let runId: string;
    try {
      runId = await this.auditLog.startRun(config.name);
    } catch (error) {
      runId = randomUUID();
      this.logger.error(`Audit startRun failed, using local runId ${runId}: ${String(error)}`);
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    if (config.hasTimeout()) {
      const timeoutMinutes = config.timeoutMinutes;
      if (timeoutMinutes == null) throw new Error('Timeout config required');
      timeoutHandle = setTimeout(
        () => {
          notifier
            ?.notifyWarning(config.name, `Backup exceeded ${timeoutMinutes} minute timeout`)
            .catch((warningError) => {
              this.logger.error(`Timeout warning notification failed: ${String(warningError)}`);
            });
        },
        timeoutMinutes * 60 * 1000,
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
      // Notification failure must not block the backup — log and continue
      if (notifier) {
        try {
          await this.executeStage(BackupStage.NotifyStarted, runId, async () => {
            await notifier.notifyStarted(config.name);
          });
        } catch (notifyError) {
          this.logger.error(`Start notification failed, continuing backup: ${String(notifyError)}`);
        }
      }

      const preBackup = config.hooks?.preBackup;
      if (config.hasHooks() && preBackup) {
        await this.executeStage(BackupStage.PreHook, runId, async () => {
          await this.hookExecutor.execute(preBackup);
        });
      }

      // Database dump/verify/encrypt — only when a database is configured
      if (config.hasDatabase() && config.database) {
        const dumper = this.dumperRegistry.create(config.database.type, config);

        dumpResult = await this.executeRetryableStage<DumpResult>(
          BackupStage.Dump,
          runId,
          () => dumper.dump(outputDir, config.name, timestamp),
          (retries) => { totalRetries += retries; },
        );

        if (config.hasVerification()) {
          const verifyPath = dumpResult.filePath;
          await this.executeRetryableStage<boolean>(
            BackupStage.Verify,
            runId,
            () => dumper.verify(verifyPath),
            (retries) => { totalRetries += retries; },
          );
          verified = true;
        }

        if (config.hasEncryption()) {
          const encryption = config.encryption;
          if (!encryption) throw new Error('Encryption config required');
          const encryptPath = dumpResult.filePath;
          const encryptedPath = await this.executeRetryableStage<string>(
            BackupStage.Encrypt,
            runId,
            () => this.encryptor.encrypt(encryptPath, encryption.recipient),
            (retries) => { totalRetries += retries; },
          );
          dumpResult = new DumpResult(encryptedPath, dumpResult.sizeBytes, dumpResult.durationMs);
          encrypted = true;
        }
      }

      const syncPaths = this.buildSyncPaths(dumpResult, config, notifier);
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

      const postBackup = config.hooks?.postBackup;
      if (config.hasHooks() && postBackup) {
        await this.executeStage(BackupStage.PostHook, runId, async () => {
          await this.hookExecutor.execute(postBackup);
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
      backupType: this.resolveBackupType(config),
      snapshotMode: config.restic.snapshotMode,
      errorStage,
      errorMessage,
      retryCount: totalRetries,
      durationMs,
    });

    await this.finalizeAudit(runId, result);
    if (notifier) {
      await this.finalizeNotification(notifier, config.name, result);
    }

    // Send heartbeat to push monitor (if configured)
    if (config.hasMonitor()) {
      await this.finalizeHeartbeat(config, result);
    }

    return result;
  }

  private async executeStage(
    stage: BackupStage,
    runId: string,
    operation: () => Promise<void>,
  ): Promise<void> {
    try {
      await this.auditLog.trackProgress(runId, stage);
    } catch (trackError) {
      this.logger.error(`Audit trackProgress failed for stage ${stage}, continuing: ${String(trackError)}`);
    }
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
    try {
      await this.auditLog.trackProgress(runId, stage);
    } catch (trackError) {
      this.logger.error(`Audit trackProgress failed for stage ${stage}, continuing: ${String(trackError)}`);
    }

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
      this.logger.error(`Audit finalization failed, writing to fallback: ${String(error)}`);
      try {
        await this.fallbackWriter.writeAuditFallback(result);
      } catch (fallbackError) {
        this.logger.error(`Audit fallback also failed — result lost for runId ${runId}: ${String(fallbackError)}`);
      }
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
      this.logger.error(`Notification failed, writing to fallback: ${String(error)}`);
      try {
        await this.fallbackWriter.writeNotificationFallback(
          result.status === BackupStatus.Success ? 'success' : 'failure',
          { projectName, result },
        );
      } catch (fallbackError) {
        this.logger.error(`Notification fallback also failed for ${projectName}: ${String(fallbackError)}`);
      }
    }
  }

  private async finalizeHeartbeat(
    config: ProjectConfig,
    result: BackupResult,
  ): Promise<void> {
    try {
      const monitor = config.monitor;
      if (!monitor) return;

      const pushToken = monitor.config.push_token as string;
      if (!pushToken) return;

      const status = result.status === BackupStatus.Success ? 'up' : 'down';
      const message = result.status === BackupStatus.Success
        ? `OK - ${formatDuration(result.durationMs)}`
        : `FAIL - ${result.errorStage ?? 'unknown'}: ${result.errorMessage ?? 'unknown error'}`;

      await this.heartbeatMonitor.sendHeartbeat(pushToken, status, message, result.durationMs);
    } catch (error) {
      this.logger.error(`Heartbeat failed for ${config.name}, continuing: ${String(error)}`);
    }
  }

  private resolveNotifier(config: ProjectConfig): NotifierPort | null {
    if (!config.notification) return null;
    return this.notifierRegistry.resolve(config.notification.type);
  }

  private buildSyncPaths(
    dumpResult: DumpResult | null,
    config: ProjectConfig,
    notifier: NotifierPort | null,
  ): string[] {
    const syncPaths: string[] = [];

    if (dumpResult) {
      syncPaths.push(dumpResult.filePath);
    }

    if (config.hasAssets()) {
      for (const assetPath of config.assets.paths) {
        if (this.filesystem.exists(assetPath)) {
          syncPaths.push(assetPath);
        } else {
          this.logger.warn(`Asset path not found, skipping: ${assetPath}`);
          notifier
            ?.notifyWarning(config.name, `Missing asset path: ${assetPath}`)
            .catch((warningError) => {
              this.logger.error(`Warning notification failed: ${String(warningError)}`);
            });
        }
      }
    }

    return syncPaths;
  }

  private buildTags(config: ProjectConfig, timestamp: string): string[] {
    const tags = [
      `project:${config.name}`,
      `timestamp:${timestamp}`,
    ];

    if (config.hasDatabase() && config.database) {
      tags.push(`db:${config.database.type}`);
    }

    return tags;
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
      backupType: 'database',
      snapshotMode: 'combined',
      errorStage: null,
      errorMessage: error.message,
      retryCount: 0,
      durationMs: 0,
    });
  }

  private resolveBackupType(config: ProjectConfig): BackupType {
    const hasDb = config.hasDatabase();
    const hasAssets = config.hasAssets();
    if (hasDb && hasAssets) return 'database+assets';
    if (hasAssets) return 'assets';
    return 'database';
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
