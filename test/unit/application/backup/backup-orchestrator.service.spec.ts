import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { BackupOrchestratorService, RemoteStorageFactory } from
  '@application/backup/backup-orchestrator.service';
import { DumperRegistry } from '@application/backup/registries/dumper.registry';
import { NotifierRegistry } from '@application/backup/registries/notifier.registry';

import { BackupLockPort } from '@domain/backup/ports/backup-lock.port';
import { DatabaseDumperPort } from '@domain/backup/ports/database-dumper.port';
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
import { RetentionPolicy } from '@domain/config/models/retention-policy.model';
import {
  BackupStage,
  BackupStatus,
  CleanupResult,
  DumpResult,
  PruneResult,
  SyncResult,
} from '@domain/backup/models';

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

// ── Mock fs module ─────────────────────────────────────────────────────

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  readdirSync: jest.fn().mockReturnValue([]),
  statfsSync: jest.fn().mockReturnValue({ bsize: 4096, bavail: 5 * 1024 * 1024 * 1024 / 4096 }),
}));

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

describe('BackupOrchestratorService', () => {
  let service: BackupOrchestratorService;

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
      createStorage: jest.fn().mockReturnValue(mockStorage),
    };

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
    mockDumperRegistry.register('postgres', mockDumper);
    mockDumperRegistry.register('mysql', mockDumper);
    mockDumperRegistry.register('mongodb', mockDumper);

    mockNotifierRegistry = new NotifierRegistry();
    mockNotifierRegistry.register('slack', mockNotifier);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackupOrchestratorService,
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

    service = module.get<BackupOrchestratorService>(BackupOrchestratorService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── runBackup ──────────────────────────────────────────────────────

  describe('runBackup', () => {
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

      const result = await service.runBackup('test-project');

      expect(result.status).toBe(BackupStatus.Success);
      expect(result.projectName).toBe('test-project');
      expect(result.runId).toBe('run-001');
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

      await service.runBackup('test-project');

      expect(mockBackupLock.acquire).toHaveBeenCalledWith('test-project');
      expect(mockBackupLock.release).toHaveBeenCalledWith('test-project');
    });

    it('releases lock even when backup fails', async () => {
      const config = buildProjectConfig();
      mockConfigLoader.getProject.mockReturnValue(config);
      mockDumper.dump.mockRejectedValue(new Error('dump crashed'));

      const result = await service.runBackup('test-project');

      expect(result.status).toBe(BackupStatus.Failed);
      expect(mockBackupLock.release).toHaveBeenCalledWith('test-project');
    });

    it('rejects with "already in progress" when lock is held', async () => {
      const config = buildProjectConfig();
      mockConfigLoader.getProject.mockReturnValue(config);
      mockBackupLock.acquire.mockResolvedValue(false);

      await expect(service.runBackup('test-project')).rejects.toThrow(
        'Backup already in progress for test-project',
      );
    });

    it('returns success result for dry run without executing backup stages', async () => {
      const config = buildProjectConfig();
      mockConfigLoader.getProject.mockReturnValue(config);
      mockStorage.listSnapshots.mockResolvedValue([]);

      const result = await service.runBackup('test-project', { dryRun: true });

      expect(result.runId).toBe('dry-run');
      expect(mockDumper.dump).not.toHaveBeenCalled();
      expect(mockStorage.sync).not.toHaveBeenCalled();
      expect(mockAuditLog.startRun).not.toHaveBeenCalled();
      expect(mockNotifier.notifyStarted).not.toHaveBeenCalled();
    });

    it('dry run validates dumper and notifier adapter resolution', async () => {
      const config = buildProjectConfig();
      mockConfigLoader.getProject.mockReturnValue(config);
      mockStorage.listSnapshots.mockResolvedValue([]);

      const report = await service.executeDryRun('test-project');

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

      const report = await service.executeDryRun('test-project');

      const resticCheck = report.checks.find((c) => c.name === 'Restic repo');
      expect(resticCheck?.passed).toBe(false);
      expect(resticCheck?.message).toContain('connection refused');
    });

    it('dry run reports failure for unknown database type', async () => {
      const config = buildProjectConfig({
        database: { type: 'redis', host: 'localhost', port: 6379, name: 'db', user: 'u', password: 'p' },
      });
      mockConfigLoader.getProject.mockReturnValue(config);

      const report = await service.executeDryRun('test-project');

      const dumperCheck = report.checks.find((c) => c.name === 'Database dumper');
      expect(dumperCheck?.passed).toBe(false);
    });

    it('tracks progress via audit for each stage', async () => {
      const config = buildProjectConfig();
      mockConfigLoader.getProject.mockReturnValue(config);

      await service.runBackup('test-project');

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

      const result = await service.runBackup('test-project');

      expect(result.status).toBe(BackupStatus.Success);
      expect(mockDumper.dump).toHaveBeenCalledTimes(3);
      expect(result.retryCount).toBe(2);
    });

    it('fails when retries are exhausted', async () => {
      const config = buildProjectConfig();
      mockConfigLoader.getProject.mockReturnValue(config);

      mockDumper.dump.mockRejectedValue(new Error('persistent failure'));

      const result = await service.runBackup('test-project');

      expect(result.status).toBe(BackupStatus.Failed);
      expect(result.errorStage).toBe(BackupStage.Dump);
      expect(result.errorMessage).toBe('persistent failure');
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

      const result = await service.runBackup('test-project');

      expect(result.status).toBe(BackupStatus.Failed);
      expect(result.errorStage).toBe(BackupStage.PreHook);
      expect(mockDumper.dump).not.toHaveBeenCalled();
      expect(mockAuditLog.finishRun).toHaveBeenCalled();
      expect(mockNotifier.notifyFailure).toHaveBeenCalled();
    });

    it('skips encryption when not configured', async () => {
      const config = buildProjectConfig({ encryption: null });
      mockConfigLoader.getProject.mockReturnValue(config);

      const result = await service.runBackup('test-project');

      expect(result.status).toBe(BackupStatus.Success);
      expect(result.encrypted).toBe(false);
      expect(mockEncryptor.encrypt).not.toHaveBeenCalled();
    });

    it('encrypts dump when encryption is configured', async () => {
      const config = buildProjectConfig({
        encryption: { enabled: true, type: 'gpg', recipient: 'admin@test.com' },
      });
      mockConfigLoader.getProject.mockReturnValue(config);

      const result = await service.runBackup('test-project');

      expect(result.status).toBe(BackupStatus.Success);
      expect(result.encrypted).toBe(true);
      expect(mockEncryptor.encrypt).toHaveBeenCalledWith(defaultDumpResult.filePath);
    });

    it('skips verification when not configured', async () => {
      const config = buildProjectConfig({ verification: { enabled: false } });
      mockConfigLoader.getProject.mockReturnValue(config);

      await service.runBackup('test-project');

      expect(mockDumper.verify).not.toHaveBeenCalled();
    });

    it('verifies dump when verification is configured', async () => {
      const config = buildProjectConfig({ verification: { enabled: true } });
      mockConfigLoader.getProject.mockReturnValue(config);

      const result = await service.runBackup('test-project');

      expect(result.verified).toBe(true);
      expect(mockDumper.verify).toHaveBeenCalledWith(defaultDumpResult.filePath);
    });

    it('skips hooks when not configured', async () => {
      const config = buildProjectConfig({ hooks: null });
      mockConfigLoader.getProject.mockReturnValue(config);

      await service.runBackup('test-project');

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

      await service.runBackup('test-project');

      expect(callOrder).toEqual(['echo pre', 'dump', 'echo post']);
    });

    it('writes to fallback when audit DB is down, backup still succeeds', async () => {
      const config = buildProjectConfig();
      mockConfigLoader.getProject.mockReturnValue(config);
      mockAuditLog.finishRun.mockRejectedValue(new Error('DB connection lost'));

      const result = await service.runBackup('test-project');

      expect(result.status).toBe(BackupStatus.Success);
      expect(mockFallbackWriter.writeAuditFallback).toHaveBeenCalledWith(
        expect.objectContaining({ status: BackupStatus.Success }),
      );
    });

    it('writes to fallback when notification fails', async () => {
      const config = buildProjectConfig();
      mockConfigLoader.getProject.mockReturnValue(config);
      mockNotifier.notifySuccess.mockRejectedValue(new Error('Slack API down'));

      const result = await service.runBackup('test-project');

      expect(result.status).toBe(BackupStatus.Success);
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

        const backupPromise = service.runBackup('test-project');

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

      await service.runBackup('test-project');

      expect(mockStorageFactory.createStorage).toHaveBeenCalledWith(config);
    });

    it('syncs with correct tags and snapshot mode', async () => {
      const config = buildProjectConfig();
      mockConfigLoader.getProject.mockReturnValue(config);

      await service.runBackup('test-project');

      expect(mockStorage.sync).toHaveBeenCalledWith(
        [defaultDumpResult.filePath],
        {
          tags: ['project:test-project', 'db:postgres', 'timestamp:20260318-100000'],
          snapshotMode: 'combined',
        },
      );
    });

    it('warns about missing asset paths and excludes them from sync', async () => {
      const fs = require('fs');
      fs.existsSync
        .mockReturnValueOnce(true) // first asset exists
        .mockReturnValueOnce(false); // second asset missing

      const config = buildProjectConfig({
        assets: { paths: ['/data/uploads', '/data/missing'] },
      });
      mockConfigLoader.getProject.mockReturnValue(config);

      await service.runBackup('test-project');

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

      const result = await service.runBackup('test-project');

      expect(result.dumpResult).toEqual(defaultDumpResult);
      expect(result.syncResult).toEqual(defaultSyncResult);
      expect(result.pruneResult).toEqual(defaultPruneResult);
      expect(result.cleanupResult).toEqual(defaultCleanupResult);
    });

    it('calculates duration from clock timestamps', async () => {
      const start = new Date('2026-03-18T10:00:00Z');
      const end = new Date('2026-03-18T10:05:00Z');
      mockClock.now.mockReturnValueOnce(start).mockReturnValue(end);

      const config = buildProjectConfig();
      mockConfigLoader.getProject.mockReturnValue(config);

      const result = await service.runBackup('test-project');

      expect(result.durationMs).toBe(300_000);
    });
  });

  // ── runAllBackups ──────────────────────────────────────────────────

  describe('runAllBackups', () => {
    it('calls runBackup for each enabled project sequentially', async () => {
      const projectA = buildProjectConfig({ name: 'project-a' });
      const projectB = buildProjectConfig({ name: 'project-b' });
      const disabledProject = buildProjectConfig({ name: 'disabled', enabled: false });

      mockConfigLoader.loadAll.mockReturnValue([projectA, projectB, disabledProject]);
      mockConfigLoader.getProject.mockImplementation((name: string) => {
        if (name === 'project-a') return projectA;
        return projectB;
      });

      const results = await service.runAllBackups();

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

      const results = await service.runAllBackups();

      expect(results).toHaveLength(2);
      expect(results[0].status).toBe(BackupStatus.Failed);
      expect(results[0].errorMessage).toContain('already in progress');
      expect(results[1].status).toBe(BackupStatus.Success);
    });
  });

  // ── restoreBackup ──────────────────────────────────────────────────

  describe('restoreBackup', () => {
    it('calls storage.restore with correct arguments', async () => {
      const config = buildProjectConfig();
      mockConfigLoader.getProject.mockReturnValue(config);

      await service.restoreBackup('test-project', 'snap-123', '/restore/target');

      expect(mockStorage.restore).toHaveBeenCalledWith('snap-123', '/restore/target');
    });

    it('filters to dump paths when --only db', async () => {
      const config = buildProjectConfig();
      mockConfigLoader.getProject.mockReturnValue(config);

      await service.restoreBackup('test-project', 'snap-123', '/restore/target', {
        only: 'db',
      });

      expect(mockStorage.restore).toHaveBeenCalledWith(
        'snap-123',
        '/restore/target',
        ['/data/backups/test-project'],
      );
    });

    it('filters to asset paths when --only assets', async () => {
      const config = buildProjectConfig({
        assets: { paths: ['/data/uploads', '/data/media'] },
      });
      mockConfigLoader.getProject.mockReturnValue(config);

      await service.restoreBackup('test-project', 'snap-123', '/restore/target', {
        only: 'assets',
      });

      expect(mockStorage.restore).toHaveBeenCalledWith(
        'snap-123',
        '/restore/target',
        ['/data/uploads', '/data/media'],
      );
    });

    it('decompresses files when --decompress is set', async () => {
      const fs = require('fs');
      fs.readdirSync.mockReturnValue(['dump.sql.gz', 'readme.txt']);

      const config = buildProjectConfig();
      mockConfigLoader.getProject.mockReturnValue(config);

      // Mock safeExecFile via jest module mock
      const childProcessUtil = require('@shared/child-process.util');
      jest.spyOn(childProcessUtil, 'safeExecFile').mockResolvedValue({ stdout: '', stderr: '' });

      await service.restoreBackup('test-project', 'snap-123', '/restore/target', {
        decompress: true,
      });

      expect(childProcessUtil.safeExecFile).toHaveBeenCalledWith('gunzip', [
        '/restore/target/dump.sql.gz',
      ]);
    });
  });

  // ── getRestoreGuide ────────────────────────────────────────────────

  describe('getRestoreGuide', () => {
    it('returns pg_restore instructions for postgres', () => {
      const config = buildProjectConfig({ database: { type: 'postgres', host: 'db-host', port: 5432, name: 'mydb', user: 'admin', password: 'pass' } });
      mockConfigLoader.getProject.mockReturnValue(config);

      const guide = service.getRestoreGuide('test-project');

      expect(guide).toContain('PostgreSQL');
      expect(guide).toContain('pg_restore');
      expect(guide).toContain('db-host');
    });

    it('returns mysql instructions for mysql', () => {
      const config = buildProjectConfig({ database: { type: 'mysql', host: 'db-host', port: 3306, name: 'mydb', user: 'admin', password: 'pass' } });
      mockConfigLoader.getProject.mockReturnValue(config);

      const guide = service.getRestoreGuide('test-project');

      expect(guide).toContain('MySQL');
      expect(guide).toContain('mysql');
    });

    it('returns mongorestore instructions for mongodb', () => {
      const config = buildProjectConfig({ database: { type: 'mongodb', host: 'db-host', port: 27017, name: 'mydb', user: 'admin', password: 'pass' } });
      mockConfigLoader.getProject.mockReturnValue(config);

      const guide = service.getRestoreGuide('test-project');

      expect(guide).toContain('MongoDB');
      expect(guide).toContain('mongorestore');
    });

    it('returns fallback message for unknown database type', () => {
      const config = buildProjectConfig({ database: { type: 'redis', host: 'db-host', port: 6379, name: 'mydb', user: 'admin', password: 'pass' } });
      mockConfigLoader.getProject.mockReturnValue(config);

      const guide = service.getRestoreGuide('test-project');

      expect(guide).toContain('No restore guide available');
    });
  });

  // ── pruneProject ──────────────────────────────────────────────────

  describe('pruneProject', () => {
    it('delegates to storage.prune with retention config', async () => {
      const config = buildProjectConfig();
      mockConfigLoader.getProject.mockReturnValue(config);

      const result = await service.pruneProject('test-project');

      expect(mockStorageFactory.createStorage).toHaveBeenCalledWith(config);
      expect(mockStorage.prune).toHaveBeenCalledWith(config.retention);
      expect(result).toEqual(defaultPruneResult);
    });
  });

  // ── pruneAll ──────────────────────────────────────────────────────

  describe('pruneAll', () => {
    it('prunes all enabled projects and collects results', async () => {
      const projectA = buildProjectConfig({ name: 'project-a' });
      const projectB = buildProjectConfig({ name: 'project-b' });
      mockConfigLoader.loadAll.mockReturnValue([projectA, projectB]);
      mockConfigLoader.getProject.mockImplementation((name: string) => {
        if (name === 'project-a') return projectA;
        return projectB;
      });

      const results = await service.pruneAll();

      expect(results).toHaveLength(2);
    });

    it('continues on individual prune failure', async () => {
      const projectA = buildProjectConfig({ name: 'project-a' });
      const projectB = buildProjectConfig({ name: 'project-b' });
      mockConfigLoader.loadAll.mockReturnValue([projectA, projectB]);
      mockConfigLoader.getProject.mockImplementation((name: string) => {
        if (name === 'project-a') return projectA;
        return projectB;
      });

      mockStorage.prune
        .mockRejectedValueOnce(new Error('prune failed'))
        .mockResolvedValueOnce(defaultPruneResult);

      const results = await service.pruneAll();

      expect(results).toHaveLength(1);
    });
  });
});
