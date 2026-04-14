import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';

import { RunBackupUseCase } from '@domain/backup/application/use-cases/run-backup/run-backup.use-case';
import { RunBackupCommand } from '@domain/backup/application/use-cases/run-backup/run-backup.command';
import { DumperRegistry } from '@domain/backup/application/registries/dumper.registry';
import { NotifierRegistry } from '@domain/notification/application/registries/notifier.registry';
import { FileSystemPort } from '@common/filesystem/filesystem.port';
import { GpgKeyManagerPort } from '@domain/backup/application/ports/gpg-key-manager.port';

import { ProjectConfig } from '@domain/config/domain/project-config.model';
import { ConfigLoaderPort, ValidationResult } from '@domain/config/application/ports/config-loader.port';
import { DatabaseDumperPort } from '@domain/backup/application/ports/database-dumper.port';
import { RemoteStoragePort } from '@domain/backup/application/ports/remote-storage.port';
import { NotifierPort } from '@domain/notification/application/ports/notifier.port';
import { AuditLogPort } from '@domain/audit/application/ports/audit-log.port';
import { FallbackWriterPort, FallbackEntry } from '@domain/audit/application/ports/fallback-writer.port';
import { BackupLockPort } from '@domain/backup/application/ports/backup-lock.port';
import { ClockPort } from '@common/clock/clock.port';
import { DumpEncryptorPort } from '@domain/backup/application/ports/dump-encryptor.port';
import { HookExecutorPort } from '@domain/backup/application/ports/hook-executor.port';
import { LocalCleanupPort } from '@domain/backup/application/ports/local-cleanup.port';
import { BackupResult } from '@domain/backup/domain/backup-result.model';
import { BackupStage } from '@domain/backup/domain/value-objects/backup-stage.enum';
import { BackupStatus } from '@domain/backup/domain/value-objects/backup-status.enum';
import { DumpResult } from '@domain/backup/domain/value-objects/dump-result.model';
import { SyncResult } from '@domain/backup/domain/value-objects/sync-result.model';
import { PruneResult } from '@domain/backup/domain/value-objects/prune-result.model';
import { CleanupResult } from '@domain/backup/domain/value-objects/cleanup-result.model';
import { RetentionPolicy } from '@domain/config/domain/retention-policy.model';
import { CacheInfo } from '@domain/backup/domain/value-objects/cache-info.model';

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
  FILESYSTEM_PORT,
  GPG_KEY_MANAGER_PORT,
  REMOTE_STORAGE_FACTORY,
  HEARTBEAT_MONITOR_PORT,
} from '@common/di/injection-tokens';

jest.setTimeout(30000);

// ── Test project config ─────────────────────────────────────────────────

function buildTestConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return new ProjectConfig({
    name: 'vinsware',
    enabled: true,
    cron: '0 2 * * *',
    timeoutMinutes: null,
    database: {
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      name: 'vinsware_prod',
      user: 'vinsware_user',
      password: 'test-pass',
    },
    compression: { enabled: true },
    assets: { paths: [] },
    restic: {
      repositoryPath: 'sftp:storage:/backups/vinsware',
      password: 'restic-pass',
      snapshotMode: 'combined',
    },
    retention: new RetentionPolicy(7, 7, 4, 3),
    encryption: null,
    hooks: null,
    verification: { enabled: false },
    notification: { type: 'slack', config: {} },
    monitor: null,
    ...overrides,
  });
}

// ── In-memory audit log ─────────────────────────────────────────────────

class InMemoryAuditLog implements AuditLogPort {
  readonly records: Array<{
    runId: string;
    projectName: string;
    status: BackupStatus;
    currentStage: BackupStage;
    startedAt: Date;
    completedAt: Date | null;
    result: BackupResult | null;
  }> = [];

  private counter = 0;

  async startRun(projectName: string): Promise<string> {
    const runId = `run-${++this.counter}`;
    this.records.push({
      runId,
      projectName,
      status: BackupStatus.Started,
      currentStage: BackupStage.NotifyStarted,
      startedAt: new Date(),
      completedAt: null,
      result: null,
    });
    return runId;
  }

  async trackProgress(runId: string, stage: BackupStage): Promise<void> {
    const record = this.records.find((r) => r.runId === runId);
    if (record) {
      record.currentStage = stage;
    }
  }

  async finishRun(runId: string, result: BackupResult): Promise<void> {
    const record = this.records.find((r) => r.runId === runId);
    if (record) {
      record.status = result.status;
      record.completedAt = result.completedAt;
      record.result = result;
    }
  }

  async findByProject(_projectName: string, _limit?: number): Promise<BackupResult[]> {
    return [];
  }

  async findFailed(_projectName: string, _limit?: number): Promise<BackupResult[]> {
    return [];
  }

  async findSince(_since: Date): Promise<BackupResult[]> {
    return [];
  }

  async findOrphaned(): Promise<BackupResult[]> {
    return [];
  }
}

// ── In-memory fallback writer ───────────────────────────────────────────

class InMemoryFallbackWriter implements FallbackWriterPort {
  readonly entries: FallbackEntry[] = [];

  async writeAuditFallback(_result: BackupResult): Promise<void> {
    // no-op for tests
  }

  async writeNotificationFallback(_type: string, _payload: unknown): Promise<void> {
    // no-op for tests
  }

  async readPendingEntries(): Promise<FallbackEntry[]> {
    return this.entries;
  }

  async clearReplayed(_ids: string[]): Promise<void> {
    // no-op
  }
}

// ── File-based backup lock using temp dir ───────────────────────────────

class TestFileBackupLock implements BackupLockPort {
  constructor(private readonly baseDir: string) {}

  async acquire(projectName: string): Promise<boolean> {
    const lockPath = this.lockFilePath(projectName);
    if (fs.existsSync(lockPath)) return false;
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, new Date().toISOString(), 'utf-8');
    return true;
  }

  async acquireOrQueue(projectName: string): Promise<void> {
    while (!(await this.acquire(projectName))) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  async release(projectName: string): Promise<void> {
    const lockPath = this.lockFilePath(projectName);
    try { fs.unlinkSync(lockPath); } catch { /* already removed */ }
  }

  isLocked(projectName: string): boolean {
    return fs.existsSync(this.lockFilePath(projectName));
  }

  private lockFilePath(projectName: string): string {
    return path.join(this.baseDir, projectName, '.lock');
  }
}

// ── Test setup ──────────────────────────────────────────────────────────

describe('RunBackupUseCase (integration flow)', () => {
  let moduleRef: TestingModule;
  let orchestrator: RunBackupUseCase;
  let tempDir: string;

  // Mock ports
  let mockDumper: jest.Mocked<DatabaseDumperPort>;
  let mockStorage: jest.Mocked<RemoteStoragePort>;
  let mockNotifier: jest.Mocked<NotifierPort>;
  let mockEncryptor: jest.Mocked<DumpEncryptorPort>;
  let mockHookExecutor: jest.Mocked<HookExecutorPort>;
  let mockCleanup: jest.Mocked<LocalCleanupPort>;
  let auditLog: InMemoryAuditLog;
  let backupLock: TestFileBackupLock;

  const testConfig = buildTestConfig();

  const configLoader: ConfigLoaderPort = {
    loadAll: () => [testConfig],
    getProject: (name: string) => {
      if (name === 'vinsware') return testConfig;
      throw new Error(`Project "${name}" not found in configuration`);
    },
    validate: (): ValidationResult => ({ isValid: true, errors: [] }),
    reload: () => { /* no-op */ },
  };

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backupctl-flow-test-'));

    mockDumper = {
      dump: jest.fn().mockResolvedValue(new DumpResult('/data/backups/vinsware/dump.sql.gz', 1024000, 5000)),
      verify: jest.fn().mockResolvedValue(true),
      testConnection: jest.fn().mockResolvedValue(undefined),
    };

    mockStorage = {
      sync: jest.fn().mockResolvedValue(new SyncResult('snap-abc123', 2, 1, 512000, 8000)),
      prune: jest.fn().mockResolvedValue(new PruneResult(1, '100MB')),
      listSnapshots: jest.fn().mockResolvedValue([]),
      restore: jest.fn().mockResolvedValue(undefined),
      exec: jest.fn().mockResolvedValue(''),
      getCacheInfo: jest.fn().mockResolvedValue({ totalSize: '10MB', location: '/tmp/cache' } as unknown as CacheInfo),
      clearCache: jest.fn().mockResolvedValue(undefined),
      unlock: jest.fn().mockResolvedValue(undefined),
    };

    mockNotifier = {
      notifyStarted: jest.fn().mockResolvedValue(undefined),
      notifySuccess: jest.fn().mockResolvedValue(undefined),
      notifyFailure: jest.fn().mockResolvedValue(undefined),
      notifyWarning: jest.fn().mockResolvedValue(undefined),
      notifyDailySummary: jest.fn().mockResolvedValue(undefined),
    };

    mockEncryptor = {
      encrypt: jest.fn().mockResolvedValue('/data/backups/vinsware/dump.sql.gz.gpg'),
      decrypt: jest.fn().mockResolvedValue('/data/backups/vinsware/dump.sql.gz'),
    };

    mockHookExecutor = {
      execute: jest.fn().mockResolvedValue(undefined),
    };

    mockCleanup = {
      cleanup: jest.fn().mockResolvedValue(new CleanupResult(3, 2048)),
    };

    auditLog = new InMemoryAuditLog();
    backupLock = new TestFileBackupLock(tempDir);

    const dumperRegistry = new DumperRegistry();
    dumperRegistry.register('postgres', () => mockDumper);

    const notifierRegistry = new NotifierRegistry();
    notifierRegistry.register('slack', mockNotifier);

    const storageFactory = {
      create: () => mockStorage,
    };

    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true })],
      providers: [
        RunBackupUseCase,
        { provide: CONFIG_LOADER_PORT, useValue: configLoader },
        { provide: DUMPER_REGISTRY, useValue: dumperRegistry },
        { provide: NOTIFIER_REGISTRY, useValue: notifierRegistry },
        { provide: BACKUP_LOCK_PORT, useValue: backupLock },
        { provide: AUDIT_LOG_PORT, useValue: auditLog },
        { provide: FALLBACK_WRITER_PORT, useValue: new InMemoryFallbackWriter() },
        { provide: CLOCK_PORT, useValue: { now: () => new Date(), timestamp: () => '20260318-020000' } satisfies ClockPort },
        { provide: DUMP_ENCRYPTOR_PORT, useValue: mockEncryptor },
        { provide: HOOK_EXECUTOR_PORT, useValue: mockHookExecutor },
        { provide: LOCAL_CLEANUP_PORT, useValue: mockCleanup },
        { provide: REMOTE_STORAGE_FACTORY, useValue: storageFactory },
        { provide: FILESYSTEM_PORT, useValue: { exists: () => true, diskFreeGb: () => 20, listDirectory: () => [], removeFile: () => undefined } satisfies FileSystemPort },
        { provide: GPG_KEY_MANAGER_PORT, useValue: { importKey: jest.fn(), importAllFromDirectory: jest.fn().mockResolvedValue([]), listKeys: jest.fn().mockResolvedValue(''), hasKey: jest.fn().mockResolvedValue(true) } satisfies GpgKeyManagerPort },
        { provide: HEARTBEAT_MONITOR_PORT, useValue: { sendHeartbeat: jest.fn().mockResolvedValue(undefined), checkConnectivity: jest.fn().mockResolvedValue(true) } },
      ],
    }).compile();

    orchestrator = moduleRef.get(RunBackupUseCase);
  });

  afterEach(async () => {
    await moduleRef?.close();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // ── Happy path ──────────────────────────────────────────────────────

  it('should complete full backup flow: dump → sync → prune → cleanup → audit → notify', async () => {
    const [result] = await orchestrator.execute(new RunBackupCommand({ projectName: 'vinsware' }));

    expect(result.status).toBe(BackupStatus.Success);
    expect(result.projectName).toBe('vinsware');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    // Verify each step was called
    expect(mockNotifier.notifyStarted).toHaveBeenCalledWith('vinsware');
    expect(mockDumper.dump).toHaveBeenCalled();
    expect(mockStorage.sync).toHaveBeenCalled();
    expect(mockStorage.prune).toHaveBeenCalled();
    expect(mockCleanup.cleanup).toHaveBeenCalled();
    expect(mockNotifier.notifySuccess).toHaveBeenCalledWith(expect.objectContaining({
      status: BackupStatus.Success,
    }));

    // Verify audit was tracked
    expect(auditLog.records).toHaveLength(1);
    expect(auditLog.records[0].status).toBe(BackupStatus.Success);
    expect(auditLog.records[0].result).not.toBeNull();

    // Verify lock was released
    expect(backupLock.isLocked('vinsware')).toBe(false);
  });

  // ── Lock prevents concurrent backup ────────────────────────────────

  it('should prevent concurrent backup via lock', async () => {
    // Manually acquire the lock
    await backupLock.acquire('vinsware');

    await expect(orchestrator.execute(new RunBackupCommand({ projectName: 'vinsware' }))).rejects.toThrow(
      'Backup already in progress for vinsware',
    );

    // Release for cleanup
    await backupLock.release('vinsware');
  });

  // ── Dry run ────────────────────────────────────────────────────────

  it('should not execute backup steps during dry run', async () => {
    const [result] = await orchestrator.execute(new RunBackupCommand({ projectName: 'vinsware', isDryRun: true }));

    expect(result.projectName).toBe('vinsware');
    expect(result.runId).toBe('dry-run');
    expect(result.status).toBe(BackupStatus.Success);

    expect(mockDumper.dump).not.toHaveBeenCalled();
    expect(mockStorage.sync).not.toHaveBeenCalled();
    expect(mockStorage.prune).not.toHaveBeenCalled();
    expect(mockCleanup.cleanup).not.toHaveBeenCalled();
    expect(mockNotifier.notifyStarted).not.toHaveBeenCalled();
  });

  // ── Retry on dump failure ──────────────────────────────────────────

  it('should retry on dump failure up to max retries', async () => {
    let callCount = 0;
    mockDumper.dump.mockImplementation(async () => {
      callCount++;
      if (callCount < 3) {
        throw new Error('pg_dump connection refused');
      }
      return new DumpResult('/data/backups/vinsware/dump.sql.gz', 1024000, 5000);
    });

    const [result] = await orchestrator.execute(new RunBackupCommand({ projectName: 'vinsware' }));

    expect(result.status).toBe(BackupStatus.Success);
    // First call + 2 retries = 3 total calls
    expect(mockDumper.dump).toHaveBeenCalledTimes(3);
    expect(result.retryCount).toBeGreaterThan(0);
  });

  // ── Failure after max retries ──────────────────────────────────────

  it('should fail after exhausting retries', async () => {
    mockDumper.dump.mockRejectedValue(new Error('pg_dump persistent failure'));

    const [result] = await orchestrator.execute(new RunBackupCommand({ projectName: 'vinsware' }));

    expect(result.status).toBe(BackupStatus.Failed);
    expect(result.errorStage).toBe(BackupStage.Dump);
    expect(result.errorMessage).toContain('pg_dump persistent failure');

    // Verify failure notification was sent
    expect(mockNotifier.notifyFailure).toHaveBeenCalled();

    // Verify lock was still released
    expect(backupLock.isLocked('vinsware')).toBe(false);
  });

  // ── Audit records stages ──────────────────────────────────────────

  it('should track progress through audit log stages', async () => {
    const trackSpy = jest.spyOn(auditLog, 'trackProgress');

    await orchestrator.execute(new RunBackupCommand({ projectName: 'vinsware' }));

    expect(trackSpy).toHaveBeenCalledWith(expect.any(String), BackupStage.NotifyStarted);
    expect(trackSpy).toHaveBeenCalledWith(expect.any(String), BackupStage.Dump);
    expect(trackSpy).toHaveBeenCalledWith(expect.any(String), BackupStage.Sync);
    expect(trackSpy).toHaveBeenCalledWith(expect.any(String), BackupStage.Prune);
    expect(trackSpy).toHaveBeenCalledWith(expect.any(String), BackupStage.Cleanup);
  });

  // ── Sync receives correct paths and tags ──────────────────────────

  it('should pass dump file path and tags to storage sync', async () => {
    await orchestrator.execute(new RunBackupCommand({ projectName: 'vinsware' }));

    expect(mockStorage.sync).toHaveBeenCalledWith(
      ['/data/backups/vinsware/dump.sql.gz'],
      expect.objectContaining({
        tags: expect.arrayContaining([
          'project:vinsware',
          'db:postgres',
        ]),
        snapshotMode: 'combined',
      }),
    );
  });
});
