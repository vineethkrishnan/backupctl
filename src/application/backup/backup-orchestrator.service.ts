import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs';

import { BackupUseCase, RestoreOptions } from '@domain/backup/ports/backup.use-case';
import { BackupLockPort } from '@domain/backup/ports/backup-lock.port';
import { DumpEncryptorPort } from '@domain/backup/ports/dump-encryptor.port';
import { HookExecutorPort } from '@domain/backup/ports/hook-executor.port';
import { LocalCleanupPort } from '@domain/backup/ports/local-cleanup.port';
import { RemoteStoragePort } from '@domain/backup/ports/remote-storage.port';
import { AuditLogPort } from '@domain/audit/ports/audit-log.port';
import { FallbackWriterPort } from '@domain/audit/ports/fallback-writer.port';
import { NotifierPort } from '@domain/notification/ports/notifier.port';
import { ConfigLoaderPort } from '@domain/config/ports/config-loader.port';
import { ClockPort } from '@domain/shared/ports/clock.port';
import { ProjectConfig } from '@domain/config/models/project-config.model';
import {
  BackupResult,
  BackupStage,
  BackupStageError,
  BackupStatus,
  CleanupResult,
  DumpResult,
  PruneResult,
  SyncResult,
} from '@domain/backup/models';
import { evaluateRetry } from '@domain/backup/policies/retry.policy';

import { DumperRegistry } from '@application/backup/registries/dumper.registry';
import { NotifierRegistry } from '@application/backup/registries/notifier.registry';

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
} from '@shared/injection-tokens';
import { safeExecFile } from '@shared/child-process.util';

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
export class BackupOrchestratorService implements BackupUseCase {
  private readonly logger = new Logger(BackupOrchestratorService.name);
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

  // ── Run single backup ───────────────────────────────────────────────

  async runBackup(
    projectName: string,
    options?: { dryRun?: boolean },
  ): Promise<BackupResult> {
    const config = this.configLoader.getProject(projectName);

    const acquired = await this.backupLock.acquire(projectName);
    if (!acquired) {
      throw new Error(`Backup already in progress for ${projectName}`);
    }

    try {
      return await this.executeBackup(config, options?.dryRun ?? false);
    } finally {
      await this.backupLock.release(projectName);
    }
  }

  // ── Run all enabled backups sequentially ────────────────────────────

  async runAllBackups(): Promise<BackupResult[]> {
    const projects = this.configLoader.loadAll().filter((project) => project.enabled);
    const results: BackupResult[] = [];

    for (const project of projects) {
      try {
        const result = await this.runBackup(project.name);
        results.push(result);
      } catch (error) {
        this.logger.error(`Backup failed for ${project.name}: ${(error as Error).message}`);
        results.push(this.buildFailureResult(project.name, error as Error));
      }
    }

    return results;
  }

  // ── Restore backup ─────────────────────────────────────────────────

  async restoreBackup(
    projectName: string,
    snapshotId: string,
    targetPath: string,
    options?: RestoreOptions,
  ): Promise<void> {
    const config = this.configLoader.getProject(projectName);
    const storage = this.storageFactory.createStorage(config);
    const outputDir = path.join(this.baseDir, projectName);

    if (options?.only === 'db') {
      await storage.restore(snapshotId, targetPath, [outputDir]);
    } else if (options?.only === 'assets') {
      await storage.restore(snapshotId, targetPath, [...config.assets.paths]);
    } else {
      await storage.restore(snapshotId, targetPath);
    }

    if (options?.decompress) {
      await this.decompressFiles(targetPath);
    }
  }

  // ── Restore guide ──────────────────────────────────────────────────

  getRestoreGuide(projectName: string): string {
    const config = this.configLoader.getProject(projectName);
    const dbType = config.database.type.toLowerCase();

    const guides: Record<string, string> = {
      postgres: [
        'Restore steps for PostgreSQL:',
        `1. pg_restore -h ${config.database.host} -p ${config.database.port} -U ${config.database.user} -d ${config.database.name} <dump_file>`,
        '2. If compressed: gunzip the file first, then run pg_restore',
        '3. If encrypted: gpg --decrypt <file>.gpg > <file> first',
      ].join('\n'),
      mysql: [
        'Restore steps for MySQL:',
        `1. mysql -h ${config.database.host} -P ${config.database.port} -u ${config.database.user} -p ${config.database.name} < <dump_file>`,
        '2. If compressed: gunzip the file first, then import',
        '3. If encrypted: gpg --decrypt <file>.gpg > <file> first',
      ].join('\n'),
      mongodb: [
        'Restore steps for MongoDB:',
        `1. mongorestore --host ${config.database.host} --port ${config.database.port} -u ${config.database.user} -d ${config.database.name} <dump_directory>`,
        '2. If compressed: the archive will be auto-decompressed by mongorestore',
        '3. If encrypted: gpg --decrypt <file>.gpg > <file> first',
      ].join('\n'),
    };

    return guides[dbType] ?? `No restore guide available for database type: ${dbType}`;
  }

  // ── Prune single project ───────────────────────────────────────────

  async pruneProject(projectName: string): Promise<PruneResult> {
    const config = this.configLoader.getProject(projectName);
    const storage = this.storageFactory.createStorage(config);
    return storage.prune(config.retention);
  }

  // ── Prune all enabled projects ─────────────────────────────────────

  async pruneAll(): Promise<PruneResult[]> {
    const projects = this.configLoader.loadAll().filter((project) => project.enabled);
    const results: PruneResult[] = [];

    for (const project of projects) {
      try {
        const result = await this.pruneProject(project.name);
        results.push(result);
      } catch (error) {
        this.logger.error(`Prune failed for ${project.name}: ${(error as Error).message}`);
      }
    }

    return results;
  }

  // ── Private: execute full backup flow ──────────────────────────────

  // ── Dry run: validate config + connectivity without executing ─────

  async executeDryRun(projectName: string): Promise<DryRunReport> {
    const checks: DryRunCheck[] = [];

    // Check 1: Load project config
    let config: ProjectConfig;
    try {
      config = this.configLoader.getProject(projectName);
      checks.push({ name: 'Config loaded', passed: true, message: `Project "${projectName}" configuration is valid` });
    } catch (error) {
      checks.push({ name: 'Config loaded', passed: false, message: `Failed to load config: ${(error as Error).message}` });
      return { projectName, checks, allPassed: false };
    }

    // Check 2: Resolve database dumper adapter
    try {
      this.dumperRegistry.resolve(config.database.type);
      checks.push({ name: 'Database dumper', passed: true, message: `Adapter found for database type: ${config.database.type}` });
    } catch (error) {
      checks.push({ name: 'Database dumper', passed: false, message: (error as Error).message });
    }

    // Check 3: Resolve notifier adapter
    try {
      const notificationType = config.notification?.type ?? 'slack';
      this.notifierRegistry.resolve(notificationType);
      checks.push({ name: 'Notifier', passed: true, message: `Adapter found for notification type: ${notificationType}` });
    } catch (error) {
      checks.push({ name: 'Notifier', passed: false, message: (error as Error).message });
    }

    // Check 4: Restic repo accessibility (read-only snapshots call)
    try {
      const storage = this.storageFactory.createStorage(config);
      await storage.listSnapshots();
      checks.push({ name: 'Restic repo', passed: true, message: `Repository accessible at ${config.restic.repositoryPath}` });
    } catch (error) {
      checks.push({ name: 'Restic repo', passed: false, message: `Repository unreachable: ${(error as Error).message}` });
    }

    // Check 5: Disk space
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

    // Check 6: GPG key availability (if encryption enabled)
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

    // Check 7: Asset paths exist
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

  private async executeBackup(config: ProjectConfig, isDryRun: boolean): Promise<BackupResult> {
    const startedAt = this.clock.now();
    const timestamp = this.clock.timestamp();

    if (isDryRun) {
      const report = await this.executeDryRun(config.name);
      return new BackupResult({
        runId: 'dry-run',
        projectName: config.name,
        status: report.allPassed ? BackupStatus.Success : BackupStatus.Failed,
        currentStage: BackupStage.NotifyResult,
        startedAt,
        completedAt: this.clock.now(),
        dumpResult: null,
        syncResult: null,
        pruneResult: null,
        cleanupResult: null,
        encrypted: false,
        verified: false,
        snapshotMode: config.restic.snapshotMode,
        errorStage: null,
        errorMessage: report.allPassed ? null : report.checks.filter((c) => !c.passed).map((c) => c.message).join('; '),
        retryCount: 0,
        durationMs: this.clock.now().getTime() - startedAt.getTime(),
      });
    }

    // Resolve adapters
    const dumper = this.dumperRegistry.resolve(config.database.type);
    const notifier = this.resolveNotifier(config);
    const storage = this.storageFactory.createStorage(config);
    const outputDir = path.join(this.baseDir, config.name);
    const runId = await this.auditLog.startRun(config.name);

    // Set up timeout warning
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
      // Step 1: Notify started
      await this.executeStage(BackupStage.NotifyStarted, runId, async () => {
        await notifier.notifyStarted(config.name);
      });

      // Step 2: Pre-backup hook
      if (config.hasHooks() && config.hooks!.preBackup) {
        await this.executeStage(BackupStage.PreHook, runId, async () => {
          await this.hookExecutor.execute(config.hooks!.preBackup!);
        });
      }

      // Step 3: Dump database
      dumpResult = await this.executeRetryableStage<DumpResult>(
        BackupStage.Dump,
        runId,
        () => dumper.dump(outputDir, config.name, timestamp),
        (retries) => { totalRetries += retries; },
      );

      // Step 4: Verify dump
      if (config.hasVerification()) {
        await this.executeRetryableStage<boolean>(
          BackupStage.Verify,
          runId,
          () => dumper.verify(dumpResult!.filePath),
          (retries) => { totalRetries += retries; },
        );
        verified = true;
      }

      // Step 5: Encrypt dump
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

      // Step 6: Sync to remote storage
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

      // Step 7: Prune old snapshots
      pruneResult = await this.executeRetryableStage<PruneResult>(
        BackupStage.Prune,
        runId,
        () => storage.prune(config.retention),
        (retries) => { totalRetries += retries; },
      );

      // Step 8: Local cleanup
      cleanupResult = await this.executeRetryableStage<CleanupResult>(
        BackupStage.Cleanup,
        runId,
        () => this.localCleanup.cleanup(outputDir, config.retention.localDays),
        (retries) => { totalRetries += retries; },
      );

      // Step 9: Post-backup hook
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

    // Step 10: Finalize audit
    await this.finalizeAudit(runId, result);

    // Step 11: Send result notification
    await this.finalizeNotification(notifier, config.name, result);

    return result;
  }

  // ── Private: execute a non-retryable stage ─────────────────────────

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

  // ── Private: execute a retryable stage ─────────────────────────────

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

  // ── Private: finalize audit (with fallback) ────────────────────────

  private async finalizeAudit(runId: string, result: BackupResult): Promise<void> {
    try {
      await this.auditLog.finishRun(runId, result);
    } catch (error) {
      this.logger.error(`Audit finalization failed, writing to fallback: ${error}`);
      await this.fallbackWriter.writeAuditFallback(result);
    }
  }

  // ── Private: finalize notification (with fallback) ─────────────────

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

  // ── Private: resolve notifier from config ──────────────────────────

  private resolveNotifier(config: ProjectConfig): NotifierPort {
    const notificationType = config.notification?.type ?? 'slack';
    return this.notifierRegistry.resolve(notificationType);
  }

  // ── Private: build sync paths with missing asset warnings ──────────

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

  // ── Private: build restic tags ─────────────────────────────────────

  private buildTags(config: ProjectConfig, timestamp: string): string[] {
    return [
      `project:${config.name}`,
      `db:${config.database.type}`,
      `timestamp:${timestamp}`,
    ];
  }

  // ── Private: decompress restored files ─────────────────────────────

  private async decompressFiles(targetPath: string): Promise<void> {
    const entries = fs.readdirSync(targetPath);
    for (const entry of entries) {
      if (entry.endsWith('.gz')) {
        const filePath = path.join(targetPath, entry);
        await safeExecFile('gunzip', [filePath]);
      }
    }
  }

  // ── Private: build failure result for runAllBackups ────────────────

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

  // ── Private: async delay ───────────────────────────────────────────

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
