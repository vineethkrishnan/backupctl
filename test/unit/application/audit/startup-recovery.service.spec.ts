import { RecoverStartupUseCase } from '@domain/audit/application/use-cases/recover-startup/recover-startup.use-case';
import { AuditLogPort } from '@domain/audit/application/ports/audit-log.port';
import { FallbackWriterPort, FallbackEntry } from '@domain/audit/application/ports/fallback-writer.port';
import { ConfigLoaderPort } from '@domain/config/application/ports/config-loader.port';
import { BackupLockPort } from '@domain/backup/application/ports/backup-lock.port';
import { RemoteStorageFactoryPort } from '@domain/backup/application/ports/remote-storage-factory.port';
import { RemoteStoragePort } from '@domain/backup/application/ports/remote-storage.port';
import { GpgKeyManagerPort } from '@domain/backup/application/ports/gpg-key-manager.port';
import { ClockPort } from '@common/clock/clock.port';
import { FileSystemPort } from '@common/filesystem/filesystem.port';
import { BackupResult } from '@domain/backup/domain/backup-result.model';
import { BackupStatus } from '@domain/backup/domain/value-objects/backup-status.enum';
import { BackupStage } from '@domain/backup/domain/value-objects/backup-stage.enum';
import { ProjectConfig } from '@domain/config/domain/project-config.model';
import { RetentionPolicy } from '@domain/config/domain/retention-policy.model';
import { ConfigService } from '@nestjs/config';

describe('RecoverStartupUseCase', () => {
  let service: RecoverStartupUseCase;
  let mockAuditLog: jest.Mocked<AuditLogPort>;
  let mockFallbackWriter: jest.Mocked<FallbackWriterPort>;
  let mockConfigLoader: jest.Mocked<ConfigLoaderPort>;
  let mockBackupLock: jest.Mocked<BackupLockPort>;
  let mockStorageFactory: jest.Mocked<RemoteStorageFactoryPort>;
  let mockStorage: jest.Mocked<RemoteStoragePort>;
  let mockClock: jest.Mocked<ClockPort>;
  let mockFilesystem: jest.Mocked<FileSystemPort>;
  let mockGpgKeyManager: jest.Mocked<GpgKeyManagerPort>;
  let mockConfigService: jest.Mocked<ConfigService>;

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
      monitor: null,
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
      backupType: 'database',
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

    mockFilesystem = {
      exists: jest.fn().mockReturnValue(false),
      diskFreeGb: jest.fn().mockReturnValue(100),
      listDirectory: jest.fn().mockReturnValue([]),
      removeFile: jest.fn(),
    };

    mockGpgKeyManager = {
      importKey: jest.fn(),
      importAllFromDirectory: jest.fn().mockResolvedValue([]),
      listKeys: jest.fn().mockResolvedValue(''),
      hasKey: jest.fn().mockResolvedValue(false),
    };

    mockConfigService = {
      get: jest.fn().mockReturnValue('/data/backups'),
    } as unknown as jest.Mocked<ConfigService>;

    service = new RecoverStartupUseCase(
      mockAuditLog,
      mockFallbackWriter,
      mockConfigLoader,
      mockBackupLock,
      mockStorageFactory,
      mockClock,
      mockFilesystem,
      mockGpgKeyManager,
      mockConfigService,
    );
  });

  it('marks orphaned runs as failed', async () => {
    const orphan = createOrphanedResult('run-orphan-1', 'vinsware');
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

  it('cleans orphaned dump files only for projects with orphaned runs', async () => {
    const orphan = createOrphanedResult('run-orphan-1', 'vinsware');
    mockAuditLog.findOrphaned.mockResolvedValue([orphan]);
    const projects = [createProjectConfig('vinsware')];
    mockConfigLoader.loadAll.mockReturnValue(projects);
    mockFilesystem.exists.mockReturnValue(true);
    mockFilesystem.listDirectory.mockReturnValue(['vinsware.sql.gz', 'vinsware.sql.gz.gpg', '.lock', 'notes.txt']);

    await service.onModuleInit();

    expect(mockFilesystem.removeFile).toHaveBeenCalledWith('/data/backups/vinsware/vinsware.sql.gz');
    expect(mockFilesystem.removeFile).toHaveBeenCalledWith('/data/backups/vinsware/vinsware.sql.gz.gpg');
    expect(mockFilesystem.removeFile).not.toHaveBeenCalledWith('/data/backups/vinsware/.lock');
    expect(mockFilesystem.removeFile).not.toHaveBeenCalledWith('/data/backups/vinsware/notes.txt');
  });

  it('skips dump cleanup when project has no orphaned runs', async () => {
    const projects = [createProjectConfig('newproject')];
    mockConfigLoader.loadAll.mockReturnValue(projects);
    mockFilesystem.exists.mockReturnValue(true);
    mockFilesystem.listDirectory.mockReturnValue(['dump.sql.gz']);

    await service.onModuleInit();

    expect(mockFilesystem.removeFile).not.toHaveBeenCalled();
  });

  it('releases stale locks only for projects with orphaned runs', async () => {
    const orphan1 = createOrphanedResult('run-1', 'vinsware');
    const orphan2 = createOrphanedResult('run-2', 'webapp');
    mockAuditLog.findOrphaned.mockResolvedValue([orphan1, orphan2]);
    const projects = [createProjectConfig('vinsware'), createProjectConfig('webapp'), createProjectConfig('untouched')];
    mockConfigLoader.loadAll.mockReturnValue(projects);
    mockBackupLock.isLocked.mockReturnValue(true);
    mockBackupLock.release.mockResolvedValue(undefined);

    await service.onModuleInit();

    expect(mockBackupLock.release).toHaveBeenCalledWith('vinsware');
    expect(mockBackupLock.release).toHaveBeenCalledWith('webapp');
    expect(mockBackupLock.release).not.toHaveBeenCalledWith('untouched');
  });

  it('unlocks restic repos for enabled projects (non-fatal on error)', async () => {
    const projects = [
      createProjectConfig('vinsware', true),
      createProjectConfig('webapp', true),
      createProjectConfig('disabled-project', false),
    ];
    mockConfigLoader.loadAll.mockReturnValue(projects);
    mockStorage.unlock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('repo locked by another process'));

    await service.onModuleInit();

    expect(mockStorageFactory.create).toHaveBeenCalledTimes(2);
    expect(mockStorage.unlock).toHaveBeenCalledTimes(2);
  });

  it('replays fallback entries and clears them', async () => {
    const auditEntry: FallbackEntry = {
      id: 'fb-1',
      type: 'audit',
      payload: new BackupResult({
        runId: 'run-fb-1',
        projectName: 'vinsware',
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
        backupType: 'database',
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
      payload: { project: 'vinsware', message: 'Backup succeeded' },
      timestamp: '2026-03-18T02:05:01Z',
    };

    mockFallbackWriter.readPendingEntries.mockResolvedValue([auditEntry, notificationEntry]);

    await service.onModuleInit();

    expect(mockAuditLog.finishRun).toHaveBeenCalledWith('run-fb-1', expect.anything());
    expect(mockFallbackWriter.clearReplayed).toHaveBeenCalledWith(['fb-1', 'fb-2']);
  });

  it('does not clear entries when no fallback entries exist', async () => {
    mockFallbackWriter.readPendingEntries.mockResolvedValue([]);

    await service.onModuleInit();

    expect(mockFallbackWriter.clearReplayed).not.toHaveBeenCalled();
  });

  it('imports GPG keys on startup', async () => {
    mockGpgKeyManager.importAllFromDirectory.mockResolvedValue(['admin@test.com']);

    await service.onModuleInit();

    expect(mockGpgKeyManager.importAllFromDirectory).toHaveBeenCalled();
  });

  it('handles GPG import failure gracefully', async () => {
    mockGpgKeyManager.importAllFromDirectory.mockRejectedValue(new Error('gpg not found'));

    await expect(service.onModuleInit()).resolves.not.toThrow();
  });

  it('handles dump cleanup failure for individual files gracefully', async () => {
    const orphan = createOrphanedResult('run-1', 'vinsware');
    mockAuditLog.findOrphaned.mockResolvedValue([orphan]);
    const projects = [createProjectConfig('vinsware')];
    mockConfigLoader.loadAll.mockReturnValue(projects);
    mockFilesystem.exists.mockReturnValue(true);
    mockFilesystem.listDirectory.mockReturnValue(['dump.sql.gz']);
    mockFilesystem.removeFile.mockImplementation(() => {
      throw new Error('permission denied');
    });

    await expect(service.onModuleInit()).resolves.not.toThrow();
  });
});
