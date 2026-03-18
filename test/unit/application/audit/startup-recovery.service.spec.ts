import { StartupRecoveryService } from '@application/audit/startup-recovery.service';
import { AuditLogPort } from '@domain/audit/ports/audit-log.port';
import { FallbackWriterPort, FallbackEntry } from '@domain/audit/ports/fallback-writer.port';
import { ConfigLoaderPort } from '@domain/config/ports/config-loader.port';
import { BackupLockPort } from '@domain/backup/ports/backup-lock.port';
import { RemoteStorageFactory } from '@domain/backup/ports/remote-storage-factory.port';
import { RemoteStoragePort } from '@domain/backup/ports/remote-storage.port';
import { ClockPort } from '@domain/shared/ports/clock.port';
import { BackupResult } from '@domain/backup/models/backup-result.model';
import { BackupStatus } from '@domain/backup/models/backup-status.enum';
import { BackupStage } from '@domain/backup/models/backup-stage.enum';
import { ProjectConfig } from '@domain/config/models/project-config.model';
import { RetentionPolicy } from '@domain/config/models/retention-policy.model';

describe('StartupRecoveryService', () => {
  let service: StartupRecoveryService;
  let mockAuditLog: jest.Mocked<AuditLogPort>;
  let mockFallbackWriter: jest.Mocked<FallbackWriterPort>;
  let mockConfigLoader: jest.Mocked<ConfigLoaderPort>;
  let mockBackupLock: jest.Mocked<BackupLockPort>;
  let mockStorageFactory: jest.Mocked<RemoteStorageFactory>;
  let mockStorage: jest.Mocked<RemoteStoragePort>;
  let mockClock: jest.Mocked<ClockPort>;

  const fixedNow = new Date('2026-03-18T10:00:00Z');

  const createProjectConfig = (name: string, enabled = true): ProjectConfig =>
    new ProjectConfig({
      name,
      enabled,
      cron: '0 2 * * *',
      timeoutMinutes: null,
      database: { type: 'postgres', host: 'localhost', port: 5432, name: 'db', user: 'u', password: 'p' },
      compression: { enabled: true },
      assets: { paths: [] },
      restic: { repositoryPath: '/repo', password: 'secret', snapshotMode: 'combined' },
      retention: new RetentionPolicy(7, 7, 4, 6),
      encryption: null,
      hooks: null,
      verification: { enabled: false },
      notification: null,
    });

  const createOrphanedResult = (runId: string, projectName: string): BackupResult =>
    new BackupResult({
      runId,
      projectName,
      status: BackupStatus.Started,
      currentStage: BackupStage.Dump,
      startedAt: new Date('2026-03-18T02:00:00Z'),
      completedAt: null,
      dumpResult: null,
      syncResult: null,
      pruneResult: null,
      cleanupResult: null,
      encrypted: false,
      verified: false,
      snapshotMode: 'combined',
      errorStage: null,
      errorMessage: null,
      retryCount: 0,
      durationMs: 0,
    });

  beforeEach(() => {
    mockStorage = {
      sync: jest.fn(),
      prune: jest.fn(),
      listSnapshots: jest.fn(),
      restore: jest.fn(),
      exec: jest.fn(),
      getCacheInfo: jest.fn(),
      clearCache: jest.fn(),
      unlock: jest.fn(),
    };

    mockAuditLog = {
      startRun: jest.fn(),
      trackProgress: jest.fn(),
      finishRun: jest.fn(),
      findByProject: jest.fn(),
      findFailed: jest.fn(),
      findSince: jest.fn(),
      findOrphaned: jest.fn().mockResolvedValue([]),
    };

    mockFallbackWriter = {
      writeAuditFallback: jest.fn(),
      writeNotificationFallback: jest.fn(),
      readPendingEntries: jest.fn().mockResolvedValue([]),
      clearReplayed: jest.fn(),
    };

    mockConfigLoader = {
      loadAll: jest.fn().mockReturnValue([]),
      getProject: jest.fn(),
      validate: jest.fn(),
      reload: jest.fn(),
    };

    mockBackupLock = {
      acquire: jest.fn(),
      acquireOrQueue: jest.fn(),
      release: jest.fn(),
      isLocked: jest.fn(),
    };

    mockStorageFactory = {
      create: jest.fn().mockReturnValue(mockStorage),
    };

    mockClock = {
      now: jest.fn().mockReturnValue(fixedNow),
      timestamp: jest.fn().mockReturnValue('2026-03-18T10:00:00Z'),
    };

    service = new StartupRecoveryService(
      mockAuditLog,
      mockFallbackWriter,
      mockConfigLoader,
      mockBackupLock,
      mockStorageFactory,
      mockClock,
    );
  });

  it('marks orphaned runs as failed', async () => {
    const orphan = createOrphanedResult('run-orphan-1', 'locaboo');
    mockAuditLog.findOrphaned.mockResolvedValue([orphan]);

    await service.onModuleInit();

    expect(mockAuditLog.findOrphaned).toHaveBeenCalled();
    expect(mockAuditLog.finishRun).toHaveBeenCalledWith(
      'run-orphan-1',
      expect.objectContaining({
        status: BackupStatus.Failed,
        completedAt: fixedNow,
        errorMessage: 'crash_recovery',
      }),
    );
  });

  it('releases stale locks for all projects', async () => {
    const projects = [createProjectConfig('locaboo'), createProjectConfig('webapp')];
    mockConfigLoader.loadAll.mockReturnValue(projects);
    mockBackupLock.release.mockResolvedValue(undefined);

    await service.onModuleInit();

    expect(mockBackupLock.release).toHaveBeenCalledWith('locaboo');
    expect(mockBackupLock.release).toHaveBeenCalledWith('webapp');
  });

  it('unlocks restic repos for enabled projects (non-fatal on error)', async () => {
    const projects = [
      createProjectConfig('locaboo', true),
      createProjectConfig('webapp', true),
      createProjectConfig('disabled-project', false),
    ];
    mockConfigLoader.loadAll.mockReturnValue(projects);
    mockStorage.unlock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('repo locked by another process'));

    await service.onModuleInit();

    // Only enabled projects get unlocked
    expect(mockStorageFactory.create).toHaveBeenCalledTimes(2);
    expect(mockStorage.unlock).toHaveBeenCalledTimes(2);
  });

  it('replays fallback entries and clears them', async () => {
    const auditEntry: FallbackEntry = {
      id: 'fb-1',
      type: 'audit',
      payload: new BackupResult({
        runId: 'run-fb-1',
        projectName: 'locaboo',
        status: BackupStatus.Success,
        currentStage: BackupStage.NotifyResult,
        startedAt: new Date('2026-03-18T02:00:00Z'),
        completedAt: new Date('2026-03-18T02:05:00Z'),
        dumpResult: null,
        syncResult: null,
        pruneResult: null,
        cleanupResult: null,
        encrypted: false,
        verified: false,
        snapshotMode: 'combined',
        errorStage: null,
        errorMessage: null,
        retryCount: 0,
        durationMs: 300000,
      }),
      timestamp: '2026-03-18T02:05:00Z',
    };

    const notificationEntry: FallbackEntry = {
      id: 'fb-2',
      type: 'notification',
      payload: { project: 'locaboo', message: 'Backup succeeded' },
      timestamp: '2026-03-18T02:05:01Z',
    };

    mockFallbackWriter.readPendingEntries.mockResolvedValue([auditEntry, notificationEntry]);

    await service.onModuleInit();

    expect(mockAuditLog.finishRun).toHaveBeenCalledWith('run-fb-1', expect.anything());
    expect(mockFallbackWriter.clearReplayed).toHaveBeenCalledWith(['fb-1', 'fb-2']);
  });

  it('clears replayed entries after successful replay', async () => {
    const entry: FallbackEntry = {
      id: 'fb-clear',
      type: 'audit',
      payload: new BackupResult({
        runId: 'run-clear',
        projectName: 'locaboo',
        status: BackupStatus.Success,
        currentStage: BackupStage.NotifyResult,
        startedAt: new Date(),
        completedAt: new Date(),
        dumpResult: null,
        syncResult: null,
        pruneResult: null,
        cleanupResult: null,
        encrypted: false,
        verified: false,
        snapshotMode: 'combined',
        errorStage: null,
        errorMessage: null,
        retryCount: 0,
        durationMs: 100,
      }),
      timestamp: '2026-03-18T02:00:00Z',
    };

    mockFallbackWriter.readPendingEntries.mockResolvedValue([entry]);

    await service.onModuleInit();

    expect(mockFallbackWriter.clearReplayed).toHaveBeenCalledWith(['fb-clear']);
  });

  it('does not clear entries when no fallback entries exist', async () => {
    mockFallbackWriter.readPendingEntries.mockResolvedValue([]);

    await service.onModuleInit();

    expect(mockFallbackWriter.clearReplayed).not.toHaveBeenCalled();
  });
});
