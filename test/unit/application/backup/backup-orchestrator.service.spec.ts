import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { RunBackupUseCase } from '@domain/backup/application/use-cases/run-backup/run-backup.use-case';
import { RemoteStorageFactory } from '@domain/backup/application/ports/remote-storage-factory.port';
import { RunBackupCommand } from '@domain/backup/application/use-cases/run-backup/run-backup.command';
import { DumperRegistry } from '@domain/backup/application/registries/dumper.registry';
import { NotifierRegistry } from '@domain/notification/application/registries/notifier.registry';

import { BackupLockPort } from '@domain/backup/application/ports/backup-lock.port';
import { DatabaseDumperPort } from '@domain/backup/application/ports/database-dumper.port';
import { DumpEncryptorPort } from '@domain/backup/application/ports/dump-encryptor.port';
import { GpgKeyManagerPort } from '@domain/backup/application/ports/gpg-key-manager.port';
import { HookExecutorPort } from '@domain/backup/application/ports/hook-executor.port';
import { LocalCleanupPort } from '@domain/backup/application/ports/local-cleanup.port';
import { RemoteStoragePort } from '@domain/backup/application/ports/remote-storage.port';
import { AuditLogPort } from '@domain/audit/application/ports/audit-log.port';
import { FallbackWriterPort } from '@domain/audit/application/ports/fallback-writer.port';
import { NotifierPort } from '@domain/notification/application/ports/notifier.port';
import { ConfigLoaderPort } from '@domain/config/application/ports/config-loader.port';
import { ClockPort } from '@common/clock/clock.port';
import { FileSystemPort } from '@common/filesystem/filesystem.port';
import { ProjectConfig } from '@domain/config/domain/project-config.model';
import { RetentionPolicy } from '@domain/config/domain/retention-policy.model';
import { BackupStage } from '@domain/backup/domain/value-objects/backup-stage.enum';
import { BackupStatus } from '@domain/backup/domain/value-objects/backup-status.enum';
import { CleanupResult } from '@domain/backup/domain/value-objects/cleanup-result.model';
import { DumpResult } from '@domain/backup/domain/value-objects/dump-result.model';
import { PruneResult } from '@domain/backup/domain/value-objects/prune-result.model';
import { SyncResult } from '@domain/backup/domain/value-objects/sync-result.model';

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
} from '@common/di/injection-tokens';

// ── Test helpers ───────────────────────────────────────────────────────

function createMockConfigLoader(): jest.Mocked<ConfigLoaderPort> {
  return {
    loadAll: jest.fn(),
    getProject: jest.fn(),
    validate: jest.fn(),
    reload: jest.fn(),
  };
}

function createMockDumper(): jest.Mocked<DatabaseDumperPort> {
  return {
    dump: jest.fn(),
    verify: jest.fn(),
  };
}

function createMockStorage(): jest.Mocked<RemoteStoragePort> {
  return {
    sync: jest.fn(),
    prune: jest.fn(),
    listSnapshots: jest.fn(),
    restore: jest.fn(),
    exec: jest.fn(),
    getCacheInfo: jest.fn(),
    clearCache: jest.fn(),
    unlock: jest.fn(),
  };
}

function createMockNotifier(): jest.Mocked<NotifierPort> {
  return {
    notifyStarted: jest.fn().mockResolvedValue(undefined),
    notifySuccess: jest.fn().mockResolvedValue(undefined),
    notifyFailure: jest.fn().mockResolvedValue(undefined),
    notifyWarning: jest.fn().mockResolvedValue(undefined),
    notifyDailySummary: jest.fn().mockResolvedValue(undefined),
  };
}

function createMockBackupLock(): jest.Mocked<BackupLockPort> {
  return {
    acquire: jest.fn(),
    acquireOrQueue: jest.fn(),
    release: jest.fn(),
    isLocked: jest.fn(),
  };
}

function createMockAuditLog(): jest.Mocked<AuditLogPort> {
  return {
    startRun: jest.fn(),
    trackProgress: jest.fn().mockResolvedValue(undefined),
    finishRun: jest.fn().mockResolvedValue(undefined),
    findByProject: jest.fn(),
    findFailed: jest.fn(),
    findSince: jest.fn(),
    findOrphaned: jest.fn(),
  };
}

function createMockFallbackWriter(): jest.Mocked<FallbackWriterPort> {
  return {
    writeAuditFallback: jest.fn().mockResolvedValue(undefined),
    writeNotificationFallback: jest.fn().mockResolvedValue(undefined),
    readPendingEntries: jest.fn(),
    clearReplayed: jest.fn(),
  };
}

function createMockClock(): jest.Mocked<ClockPort> {
  const baseTime = new Date('2026-03-18T10:00:00Z');
  return {
    now: jest.fn().mockReturnValue(baseTime),
    timestamp: jest.fn().mockReturnValue('20260318-100000'),
  };
}

function createMockEncryptor(): jest.Mocked<DumpEncryptorPort> {
  return {
    encrypt: jest.fn(),
    decrypt: jest.fn(),
  };
}

function createMockHookExecutor(): jest.Mocked<HookExecutorPort> {
  return {
    execute: jest.fn().mockResolvedValue(undefined),
  };
}

function createMockLocalCleanup(): jest.Mocked<LocalCleanupPort> {
  return {
    cleanup: jest.fn(),
  };
}

function createMockFilesystem(): jest.Mocked<FileSystemPort> {
  return {
    exists: jest.fn().mockReturnValue(true),
    diskFreeGb: jest.fn().mockReturnValue(20),
    listDirectory: jest.fn().mockReturnValue([]),
    removeFile: jest.fn(),
  };
}

function createMockGpgKeyManager(): jest.Mocked<GpgKeyManagerPort> {
  return {
    importKey: jest.fn().mockResolvedValue(undefined),
    importAllFromDirectory: jest.fn().mockResolvedValue([]),
    listKeys: jest.fn().mockResolvedValue(''),
    hasKey: jest.fn().mockResolvedValue(true),
  };
}

function buildProjectConfig(overrides: Partial<ConstructorParameters<typeof ProjectConfig>[0]> = {}): ProjectConfig {
  return new ProjectConfig({
    name: 'test-project',
    enabled: true,
    cron: '0 2 * * *',
    timeoutMinutes: null,
    database: {
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      name: 'testdb',
      user: 'admin',
      password: 'secret',
    },
    compression: { enabled: true },
    assets: { paths: [] },
    restic: {
      repositoryPath: '/repo/test',
      password: 'restic-pass',
      snapshotMode: 'combined',
    },
    retention: new RetentionPolicy(7, 7, 4, 3),
    encryption: null,
    hooks: null,
    verification: { enabled: false },
    notification: { type: 'slack', config: {} },
    ...overrides,
  });
}

// ── Test suite ─────────────────────────────────────────────────────────

describe('RunBackupUseCase', () => {
  let service: RunBackupUseCase;

  let mockConfigLoader: jest.Mocked<ConfigLoaderPort>;
  let mockDumper: jest.Mocked<DatabaseDumperPort>;
  let mockStorage: jest.Mocked<RemoteStoragePort>;
  let mockNotifier: jest.Mocked<NotifierPort>;
  let mockBackupLock: jest.Mocked<BackupLockPort>;
  let mockAuditLog: jest.Mocked<AuditLogPort>;
  let mockFallbackWriter: jest.Mocked<FallbackWriterPort>;
  let mockClock: jest.Mocked<ClockPort>;
  let mockEncryptor: jest.Mocked<DumpEncryptorPort>;
  let mockHookExecutor: jest.Mocked<HookExecutorPort>;
  let mockLocalCleanup: jest.Mocked<LocalCleanupPort>;
  let mockStorageFactory: jest.Mocked<RemoteStorageFactory>;
  let mockFilesystem: jest.Mocked<FileSystemPort>;
  let mockGpgKeyManager: jest.Mocked<GpgKeyManagerPort>;
  let mockDumperRegistry: DumperRegistry;
  let mockNotifierRegistry: NotifierRegistry;

  const defaultDumpResult = new DumpResult('/data/backups/test-project/dump.sql.gz', 1024, 500);
  const defaultSyncResult = new SyncResult('snap-123', 1, 0, 1024, 300);
  const defaultPruneResult = new PruneResult(2, '500MB');
  const defaultCleanupResult = new CleanupResult(3, 2048);

  beforeEach(async () => {
    mockConfigLoader = createMockConfigLoader();
    mockDumper = createMockDumper();
    mockStorage = createMockStorage();
    mockNotifier = createMockNotifier();
    mockBackupLock = createMockBackupLock();
    mockAuditLog = createMockAuditLog();
    mockFallbackWriter = createMockFallbackWriter();
    mockClock = createMockClock();
    mockEncryptor = createMockEncryptor();
    mockHookExecutor = createMockHookExecutor();
    mockLocalCleanup = createMockLocalCleanup();

    mockStorageFactory = {
      create: jest.fn().mockReturnValue(mockStorage),
    };

    mockFilesystem = createMockFilesystem();
    mockGpgKeyManager = createMockGpgKeyManager();

    // Set up default resolved values
    mockBackupLock.acquire.mockResolvedValue(true);
    mockBackupLock.release.mockResolvedValue(undefined);
    mockAuditLog.startRun.mockResolvedValue('run-001');
    mockDumper.dump.mockResolvedValue(defaultDumpResult);
    mockDumper.verify.mockResolvedValue(true);
    mockStorage.sync.mockResolvedValue(defaultSyncResult);
    mockStorage.prune.mockResolvedValue(defaultPruneResult);
    mockStorage.restore.mockResolvedValue(undefined);
    mockLocalCleanup.cleanup.mockResolvedValue(defaultCleanupResult);
    mockEncryptor.encrypt.mockResolvedValue('/data/backups/test-project/dump.sql.gz.gpg');

    mockDumperRegistry = new DumperRegistry();
    mockDumperRegistry.register('postgres', () => mockDumper);
    mockDumperRegistry.register('mysql', () => mockDumper);
    mockDumperRegistry.register('mongodb', () => mockDumper);

    mockNotifierRegistry = new NotifierRegistry();
    mockNotifierRegistry.register('slack', mockNotifier);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RunBackupUseCase,
        { provide: CONFIG_LOADER_PORT, useValue: mockConfigLoader },
        { provide: DUMPER_REGISTRY, useValue: mockDumperRegistry },
        { provide: NOTIFIER_REGISTRY, useValue: mockNotifierRegistry },
        { provide: BACKUP_LOCK_PORT, useValue: mockBackupLock },
        { provide: AUDIT_LOG_PORT, useValue: mockAuditLog },
        { provide: FALLBACK_WRITER_PORT, useValue: mockFallbackWriter },
        { provide: CLOCK_PORT, useValue: mockClock },
        { provide: DUMP_ENCRYPTOR_PORT, useValue: mockEncryptor },
        { provide: HOOK_EXECUTOR_PORT, useValue: mockHookExecutor },
        { provide: LOCAL_CLEANUP_PORT, useValue: mockLocalCleanup },
        { provide: REMOTE_STORAGE_FACTORY, useValue: mockStorageFactory },
        { provide: FILESYSTEM_PORT, useValue: mockFilesystem },
        { provide: GPG_KEY_MANAGER_PORT, useValue: mockGpgKeyManager },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue: unknown) => {
              const values: Record<string, unknown> = {
                BACKUP_RETRY_COUNT: 3,
                BACKUP_RETRY_DELAY_MS: 1,
                BACKUP_BASE_DIR: '/data/backups',
              };
              return values[key] ?? defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<RunBackupUseCase>(RunBackupUseCase);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── execute (single project) ────────────────────────────────────────

  describe('execute (single project)', () => {
    it('executes all backup stages in correct order for happy path', async () => {
      const config = buildProjectConfig();
      mockConfigLoader.getProject.mockReturnValue(config);

      const callOrder: string[] = [];
      mockNotifier.notifyStarted.mockImplementation(async () => { callOrder.push('notifyStarted'); });
      mockDumper.dump.mockImplementation(async () => { callOrder.push('dump'); return defaultDumpResult; });
      mockStorage.sync.mockImplementation(async () => { callOrder.push('sync'); return defaultSyncResult; });
      mockStorage.prune.mockImplementation(async () => { callOrder.push('prune'); return defaultPruneResult; });
      mockLocalCleanup.cleanup.mockImplementation(async () => { callOrder.push('cleanup'); return defaultCleanupResult; });
      mockAuditLog.finishRun.mockImplementation(async () => { callOrder.push('audit'); });
      mockNotifier.notifySuccess.mockImplementation(async () => { callOrder.push('notifySuccess'); });

      const results = await service.execute(new RunBackupCommand({ projectName: 'test-project' }));

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe(BackupStatus.Success);
      expect(results[0].projectName).toBe('test-project');
      expect(results[0].runId).toBe('run-001');
      expect(callOrder).toEqual([
        'notifyStarted',
        'dump',
        'sync',
        'prune',
        'cleanup',
        'audit',
        'notifySuccess',
      ]);
    });

    it('acquires lock at start and releases at end', async () => {
      const config = buildProjectConfig();
      mockConfigLoader.getProject.mockReturnValue(config);

      await service.execute(new RunBackupCommand({ projectName: 'test-project' }));

      expect(mockBackupLock.acquire).toHaveBeenCalledWith('test-project');
      expect(mockBackupLock.release).toHaveBeenCalledWith('test-project');
    });

    it('releases lock even when backup fails', async () => {
      const config = buildProjectConfig();
      mockConfigLoader.getProject.mockReturnValue(config);
      mockDumper.dump.mockRejectedValue(new Error('dump crashed'));

      const results = await service.execute(new RunBackupCommand({ projectName: 'test-project' }));

      expect(results[0].status).toBe(BackupStatus.Failed);
      expect(mockBackupLock.release).toHaveBeenCalledWith('test-project');
    });

    it('rejects with "already in progress" when lock is held', async () => {
      const config = buildProjectConfig();
      mockConfigLoader.getProject.mockReturnValue(config);
      mockBackupLock.acquire.mockResolvedValue(false);

      await expect(service.execute(new RunBackupCommand({ projectName: 'test-project' }))).rejects.toThrow(
        'Backup already in progress for test-project',
      );
    });

    it('returns success result for dry run without executing backup stages', async () => {
      const config = buildProjectConfig();
      mockConfigLoader.getProject.mockReturnValue(config);
      mockStorage.listSnapshots.mockResolvedValue([]);

      const results = await service.execute(new RunBackupCommand({ projectName: 'test-project', isDryRun: true }));

      expect(results[0].runId).toBe('dry-run');
      expect(mockDumper.dump).not.toHaveBeenCalled();
      expect(mockStorage.sync).not.toHaveBeenCalled();
      expect(mockAuditLog.startRun).not.toHaveBeenCalled();
      expect(mockNotifier.notifyStarted).not.toHaveBeenCalled();
    });

    it('dry run validates dumper and notifier adapter resolution via getDryRunReport', async () => {
      const config = buildProjectConfig();
      mockConfigLoader.getProject.mockReturnValue(config);
      mockStorage.listSnapshots.mockResolvedValue([]);

      const report = await service.getDryRunReport('test-project');

      expect(report.projectName).toBe('test-project');
      const configCheck = report.checks.find((c) => c.name === 'Config loaded');
      expect(configCheck?.passed).toBe(true);
      const dumperCheck = report.checks.find((c) => c.name === 'Database dumper');
      expect(dumperCheck?.passed).toBe(true);
      const notifierCheck = report.checks.find((c) => c.name === 'Notifier');
      expect(notifierCheck?.passed).toBe(true);
    });

    it('dry run reports failure when restic repo is unreachable', async () => {
      const config = buildProjectConfig();
      mockConfigLoader.getProject.mockReturnValue(config);
      mockStorage.listSnapshots.mockRejectedValue(new Error('connection refused'));

      const report = await service.getDryRunReport('test-project');

      const resticCheck = report.checks.find((c) => c.name === 'Restic repo');
      expect(resticCheck?.passed).toBe(false);
      expect(resticCheck?.message).toContain('connection refused');
    });

    it('dry run reports failure for unknown database type', async () => {
      const config = buildProjectConfig({
        database: { type: 'redis', host: 'localhost', port: 6379, name: 'db', user: 'u', password: 'p' },
      });
      mockConfigLoader.getProject.mockReturnValue(config);

      const report = await service.getDryRunReport('test-project');

      const dumperCheck = report.checks.find((c) => c.name === 'Database dumper');
      expect(dumperCheck?.passed).toBe(false);
    });

    it('tracks progress via audit for each stage', async () => {
      const config = buildProjectConfig();
      mockConfigLoader.getProject.mockReturnValue(config);

      await service.execute(new RunBackupCommand({ projectName: 'test-project' }));

      expect(mockAuditLog.trackProgress).toHaveBeenCalledWith('run-001', BackupStage.NotifyStarted);
      expect(mockAuditLog.trackProgress).toHaveBeenCalledWith('run-001', BackupStage.Dump);
      expect(mockAuditLog.trackProgress).toHaveBeenCalledWith('run-001', BackupStage.Sync);
      expect(mockAuditLog.trackProgress).toHaveBeenCalledWith('run-001', BackupStage.Prune);
      expect(mockAuditLog.trackProgress).toHaveBeenCalledWith('run-001', BackupStage.Cleanup);
    });

    it('retries dump stage on failure up to max retries', async () => {
      const config = buildProjectConfig();
      mockConfigLoader.getProject.mockReturnValue(config);

      mockDumper.dump
        .mockRejectedValueOnce(new Error('connection lost'))
        .mockRejectedValueOnce(new Error('connection lost'))
        .mockResolvedValueOnce(defaultDumpResult);

      const results = await service.execute(new RunBackupCommand({ projectName: 'test-project' }));

      expect(results[0].status).toBe(BackupStatus.Success);
      expect(mockDumper.dump).toHaveBeenCalledTimes(3);
      expect(results[0].retryCount).toBe(2);
    });

    it('fails when retries are exhausted', async () => {
      const config = buildProjectConfig();
      mockConfigLoader.getProject.mockReturnValue(config);

      mockDumper.dump.mockRejectedValue(new Error('persistent failure'));

      const results = await service.execute(new RunBackupCommand({ projectName: 'test-project' }));

      expect(results[0].status).toBe(BackupStatus.Failed);
      expect(results[0].errorStage).toBe(BackupStage.Dump);
      expect(results[0].errorMessage).toBe('persistent failure');
      expect(mockDumper.dump).toHaveBeenCalledTimes(3);
      expect(mockAuditLog.finishRun).toHaveBeenCalled();
      expect(mockNotifier.notifyFailure).toHaveBeenCalled();
    });

    it('fails immediately on non-retryable pre-hook error', async () => {
      const config = buildProjectConfig({
        hooks: { preBackup: 'echo pre', postBackup: null },
      });
      mockConfigLoader.getProject.mockReturnValue(config);
      mockHookExecutor.execute.mockRejectedValue(new Error('hook script failed'));

      const results = await service.execute(new RunBackupCommand({ projectName: 'test-project' }));

      expect(results[0].status).toBe(BackupStatus.Failed);
      expect(results[0].errorStage).toBe(BackupStage.PreHook);
      expect(mockDumper.dump).not.toHaveBeenCalled();
      expect(mockAuditLog.finishRun).toHaveBeenCalled();
      expect(mockNotifier.notifyFailure).toHaveBeenCalled();
    });

    it('skips encryption when not configured', async () => {
      const config = buildProjectConfig({ encryption: null });
      mockConfigLoader.getProject.mockReturnValue(config);

      const results = await service.execute(new RunBackupCommand({ projectName: 'test-project' }));

      expect(results[0].status).toBe(BackupStatus.Success);
      expect(results[0].encrypted).toBe(false);
      expect(mockEncryptor.encrypt).not.toHaveBeenCalled();
    });

    it('encrypts dump when encryption is configured', async () => {
      const config = buildProjectConfig({
        encryption: { enabled: true, type: 'gpg', recipient: 'admin@test.com' },
      });
      mockConfigLoader.getProject.mockReturnValue(config);

      const results = await service.execute(new RunBackupCommand({ projectName: 'test-project' }));

      expect(results[0].status).toBe(BackupStatus.Success);
      expect(results[0].encrypted).toBe(true);
      expect(mockEncryptor.encrypt).toHaveBeenCalledWith(defaultDumpResult.filePath, 'admin@test.com');
    });

    it('skips verification when not configured', async () => {
      const config = buildProjectConfig({ verification: { enabled: false } });
      mockConfigLoader.getProject.mockReturnValue(config);

      await service.execute(new RunBackupCommand({ projectName: 'test-project' }));

      expect(mockDumper.verify).not.toHaveBeenCalled();
    });

    it('verifies dump when verification is configured', async () => {
      const config = buildProjectConfig({ verification: { enabled: true } });
      mockConfigLoader.getProject.mockReturnValue(config);

      const results = await service.execute(new RunBackupCommand({ projectName: 'test-project' }));

      expect(results[0].verified).toBe(true);
      expect(mockDumper.verify).toHaveBeenCalledWith(defaultDumpResult.filePath);
    });

    it('skips hooks when not configured', async () => {
      const config = buildProjectConfig({ hooks: null });
      mockConfigLoader.getProject.mockReturnValue(config);

      await service.execute(new RunBackupCommand({ projectName: 'test-project' }));

      expect(mockHookExecutor.execute).not.toHaveBeenCalled();
    });

    it('executes pre and post hooks when configured', async () => {
      const config = buildProjectConfig({
        hooks: { preBackup: 'echo pre', postBackup: 'echo post' },
      });
      mockConfigLoader.getProject.mockReturnValue(config);

      const callOrder: string[] = [];
      mockHookExecutor.execute.mockImplementation(async (command: string) => {
        callOrder.push(command);
      });
      mockDumper.dump.mockImplementation(async () => {
        callOrder.push('dump');
        return defaultDumpResult;
      });

      await service.execute(new RunBackupCommand({ projectName: 'test-project' }));

      expect(callOrder).toEqual(['echo pre', 'dump', 'echo post']);
    });

    it('writes to fallback when audit DB is down, backup still succeeds', async () => {
      const config = buildProjectConfig();
      mockConfigLoader.getProject.mockReturnValue(config);
      mockAuditLog.finishRun.mockRejectedValue(new Error('DB connection lost'));

      const results = await service.execute(new RunBackupCommand({ projectName: 'test-project' }));

      expect(results[0].status).toBe(BackupStatus.Success);
      expect(mockFallbackWriter.writeAuditFallback).toHaveBeenCalledWith(
        expect.objectContaining({ status: BackupStatus.Success }),
      );
    });

    it('writes to fallback when notification fails', async () => {
      const config = buildProjectConfig();
      mockConfigLoader.getProject.mockReturnValue(config);
      mockNotifier.notifySuccess.mockRejectedValue(new Error('Slack API down'));

      const results = await service.execute(new RunBackupCommand({ projectName: 'test-project' }));

      expect(results[0].status).toBe(BackupStatus.Success);
      expect(mockFallbackWriter.writeNotificationFallback).toHaveBeenCalledWith(
        'success',
        expect.objectContaining({ projectName: 'test-project' }),
      );
    });

    it('sends timeout warning when backup exceeds configured timeout', async () => {
      jest.useFakeTimers();

      try {
        const config = buildProjectConfig({ timeoutMinutes: 1 });
        mockConfigLoader.getProject.mockReturnValue(config);

        let resolveDump: (value: DumpResult) => void;
        mockDumper.dump.mockImplementation(() => {
          return new Promise<DumpResult>((resolve) => {
            resolveDump = resolve;
          });
        });

        const backupPromise = service.execute(new RunBackupCommand({ projectName: 'test-project' }));

        // Flush microtasks so the orchestrator reaches the setTimeout setup
        await jest.advanceTimersByTimeAsync(61_000);

        expect(mockNotifier.notifyWarning).toHaveBeenCalledWith(
          'test-project',
          'Backup exceeded 1 minute timeout',
        );

        resolveDump!(defaultDumpResult);
        await jest.runAllTimersAsync();
        await backupPromise;
      } finally {
        jest.useRealTimers();
      }
    });

    it('creates storage via factory with project config', async () => {
      const config = buildProjectConfig();
      mockConfigLoader.getProject.mockReturnValue(config);

      await service.execute(new RunBackupCommand({ projectName: 'test-project' }));

      expect(mockStorageFactory.create).toHaveBeenCalledWith(config);
    });

    it('syncs with correct tags and snapshot mode', async () => {
      const config = buildProjectConfig();
      mockConfigLoader.getProject.mockReturnValue(config);

      await service.execute(new RunBackupCommand({ projectName: 'test-project' }));

      expect(mockStorage.sync).toHaveBeenCalledWith(
        [defaultDumpResult.filePath],
        {
          tags: ['project:test-project', 'db:postgres', 'timestamp:20260318-100000'],
          snapshotMode: 'combined',
        },
      );
    });

    it('warns about missing asset paths and excludes them from sync', async () => {
      mockFilesystem.exists
        .mockReturnValueOnce(true) // first asset exists
        .mockReturnValueOnce(false); // second asset missing

      const config = buildProjectConfig({
        assets: { paths: ['/data/uploads', '/data/missing'] },
      });
      mockConfigLoader.getProject.mockReturnValue(config);

      await service.execute(new RunBackupCommand({ projectName: 'test-project' }));

      expect(mockStorage.sync).toHaveBeenCalledWith(
        [defaultDumpResult.filePath, '/data/uploads'],
        expect.any(Object),
      );
      expect(mockNotifier.notifyWarning).toHaveBeenCalledWith(
        'test-project',
        'Missing asset path: /data/missing',
      );
    });

    it('includes dumpResult, syncResult, pruneResult, cleanupResult in final result', async () => {
      const config = buildProjectConfig();
      mockConfigLoader.getProject.mockReturnValue(config);

      const results = await service.execute(new RunBackupCommand({ projectName: 'test-project' }));

      expect(results[0].dumpResult).toEqual(defaultDumpResult);
      expect(results[0].syncResult).toEqual(defaultSyncResult);
      expect(results[0].pruneResult).toEqual(defaultPruneResult);
      expect(results[0].cleanupResult).toEqual(defaultCleanupResult);
    });

    it('calculates duration from clock timestamps', async () => {
      const start = new Date('2026-03-18T10:00:00Z');
      const end = new Date('2026-03-18T10:05:00Z');
      mockClock.now.mockReturnValueOnce(start).mockReturnValue(end);

      const config = buildProjectConfig();
      mockConfigLoader.getProject.mockReturnValue(config);

      const results = await service.execute(new RunBackupCommand({ projectName: 'test-project' }));

      expect(results[0].durationMs).toBe(300_000);
    });
  });

  // ── execute (isAll) ──────────────────────────────────────────────────

  describe('execute (isAll)', () => {
    it('calls runBackup for each enabled project sequentially', async () => {
      const projectA = buildProjectConfig({ name: 'project-a' });
      const projectB = buildProjectConfig({ name: 'project-b' });
      const disabledProject = buildProjectConfig({ name: 'disabled', enabled: false });

      mockConfigLoader.loadAll.mockReturnValue([projectA, projectB, disabledProject]);
      mockConfigLoader.getProject.mockImplementation((name: string) => {
        if (name === 'project-a') return projectA;
        return projectB;
      });

      const results = await service.execute(new RunBackupCommand({ isAll: true }));

      expect(results).toHaveLength(2);
      expect(results[0].projectName).toBe('project-a');
      expect(results[1].projectName).toBe('project-b');
    });

    it('continues on individual failure and collects all results', async () => {
      const projectA = buildProjectConfig({ name: 'project-a' });
      const projectB = buildProjectConfig({ name: 'project-b' });

      mockConfigLoader.loadAll.mockReturnValue([projectA, projectB]);
      mockConfigLoader.getProject.mockImplementation((name: string) => {
        if (name === 'project-a') return projectA;
        return projectB;
      });

      // First project fails to acquire lock
      mockBackupLock.acquire
        .mockResolvedValueOnce(false) // project-a fails
        .mockResolvedValueOnce(true); // project-b succeeds

      const results = await service.execute(new RunBackupCommand({ isAll: true }));

      expect(results).toHaveLength(2);
      expect(results[0].status).toBe(BackupStatus.Failed);
      expect(results[0].errorMessage).toContain('already in progress');
      expect(results[1].status).toBe(BackupStatus.Success);
    });
  });

  // ── lockHeldExternally ──────────────────────────────────────────────

  describe('lockHeldExternally', () => {
    it('skips lock acquire/release when lockHeldExternally is true', async () => {
      const config = buildProjectConfig();
      mockConfigLoader.getProject.mockReturnValue(config);

      const results = await service.execute(
        new RunBackupCommand({ projectName: 'test-project', lockHeldExternally: true }),
      );

      expect(results[0].status).toBe(BackupStatus.Success);
      expect(mockBackupLock.acquire).not.toHaveBeenCalled();
      expect(mockBackupLock.release).not.toHaveBeenCalled();
    });
  });

  // ── execute edge cases ──────────────────────────────────────────────

  describe('execute edge cases', () => {
    it('throws when projectName is missing and isAll is false', async () => {
      await expect(
        service.execute(new RunBackupCommand({})),
      ).rejects.toThrow('Project name is required when not using --all');
    });

    it('dry run reports failure for config not found', async () => {
      mockConfigLoader.getProject.mockImplementation(() => {
        throw new Error('Project "missing" not found');
      });

      const report = await service.getDryRunReport('missing');

      expect(report.allPassed).toBe(false);
      expect(report.checks[0].name).toBe('Config loaded');
      expect(report.checks[0].passed).toBe(false);
    });

    it('dry run returns failed BackupResult when checks fail', async () => {
      mockConfigLoader.getProject.mockImplementation(() => {
        throw new Error('Config error');
      });

      const results = await service.execute(
        new RunBackupCommand({ projectName: 'bad', isDryRun: true }),
      );

      expect(results[0].status).toBe(BackupStatus.Failed);
      expect(results[0].errorMessage).toContain('Config error');
      expect(results[0].runId).toBe('dry-run');
    });

    it('dry run checks GPG key when encryption is configured', async () => {
      const config = buildProjectConfig({
        encryption: { enabled: true, type: 'gpg', recipient: 'backup@test.com' },
      });
      mockConfigLoader.getProject.mockReturnValue(config);
      mockStorage.listSnapshots.mockResolvedValue([]);

      const report = await service.getDryRunReport('test-project');

      const gpgCheck = report.checks.find((c) => c.name === 'GPG key');
      expect(gpgCheck).toBeDefined();
    });

    it('dry run checks asset paths when assets configured', async () => {
      const config = buildProjectConfig({
        assets: { paths: ['/data/uploads'] },
      });
      mockConfigLoader.getProject.mockReturnValue(config);
      mockStorage.listSnapshots.mockResolvedValue([]);

      const report = await service.getDryRunReport('test-project');

      const assetCheck = report.checks.find((c) => c.name === 'Asset paths');
      expect(assetCheck).toBeDefined();
    });

    it('writes notification fallback when failure notification fails', async () => {
      const config = buildProjectConfig();
      mockConfigLoader.getProject.mockReturnValue(config);
      mockDumper.dump.mockRejectedValue(new Error('dump crash'));
      mockNotifier.notifyFailure.mockRejectedValue(new Error('Slack down'));

      const results = await service.execute(
        new RunBackupCommand({ projectName: 'test-project' }),
      );

      expect(results[0].status).toBe(BackupStatus.Failed);
      expect(mockFallbackWriter.writeNotificationFallback).toHaveBeenCalledWith(
        'failure',
        expect.objectContaining({ projectName: 'test-project' }),
      );
    });

    it('captures non-BackupStageError errors with null errorStage', async () => {
      const config = buildProjectConfig();
      mockConfigLoader.getProject.mockReturnValue(config);
      // Fail on Dump stage's trackProgress (second call), not NotifyStarted (first)
      mockAuditLog.trackProgress
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('unexpected'));

      const results = await service.execute(
        new RunBackupCommand({ projectName: 'test-project' }),
      );

      expect(results[0].status).toBe(BackupStatus.Failed);
    });
  });
});
