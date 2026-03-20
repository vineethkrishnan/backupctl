import * as fs from 'fs';
import { ConfigService } from '@nestjs/config';

import { RestoreBackupUseCase } from '@domain/backup/application/use-cases/restore-backup/restore-backup.use-case';
import { RestoreBackupCommand } from '@domain/backup/application/use-cases/restore-backup/restore-backup.command';
import { ConfigLoaderPort } from '@domain/config/application/ports/config-loader.port';
import { RemoteStorageFactoryPort } from '@domain/backup/application/ports/remote-storage-factory.port';
import { RemoteStoragePort } from '@domain/backup/application/ports/remote-storage.port';
import { ProjectConfig } from '@domain/config/domain/project-config.model';
import { RetentionPolicy } from '@domain/config/domain/retention-policy.model';

import { safeExecFile } from '@common/helpers/child-process.util';

// ── Mock fs module ─────────────────────────────────────────────────────

jest.mock('fs', () => ({
  readdirSync: jest.fn().mockReturnValue([]),
  existsSync: jest.fn().mockReturnValue(true),
}));

// ── Mock child-process.util ─────────────────────────────────────────────

jest.mock('@common/helpers/child-process.util', () => ({
  safeExecFile: jest.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}));

const safeExecFileMock = safeExecFile as jest.MockedFunction<typeof safeExecFile>;
const fsMock = fs as jest.Mocked<typeof fs> & { existsSync: jest.Mock };

// ── Test helpers ───────────────────────────────────────────────────────

function createMockConfigLoader(): jest.Mocked<ConfigLoaderPort> {
  return {
    loadAll: jest.fn(),
    getProject: jest.fn(),
    validate: jest.fn(),
    reload: jest.fn(),
  };
}

function createMockStorage(): jest.Mocked<RemoteStoragePort> {
  return {
    sync: jest.fn(),
    prune: jest.fn(),
    listSnapshots: jest.fn(),
    restore: jest.fn().mockResolvedValue(undefined),
    exec: jest.fn(),
    getCacheInfo: jest.fn(),
    clearCache: jest.fn(),
    unlock: jest.fn(),
  };
}

function buildProjectConfig(
  overrides: Partial<ConstructorParameters<typeof ProjectConfig>[0]> = {},
): ProjectConfig {
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
    assets: { paths: ['/data/uploads', '/data/static'] },
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

function createMockConfigService(): { get: jest.Mock } {
  return {
    get: jest.fn((key: string, defaultValue: unknown) => {
      const values: Record<string, unknown> = {
        BACKUP_BASE_DIR: '/data/backups',
      };
      return values[key] ?? defaultValue;
    }),
  };
}

// ── Test suite ─────────────────────────────────────────────────────────

describe('RestoreBackupUseCase', () => {
  let useCase: RestoreBackupUseCase;
  let mockConfigLoader: jest.Mocked<ConfigLoaderPort>;
  let mockStorage: jest.Mocked<RemoteStoragePort>;
  let mockStorageFactory: { create: jest.Mock };
  let mockConfigService: { get: jest.Mock };

  beforeEach(() => {
    mockConfigLoader = createMockConfigLoader();
    mockStorage = createMockStorage();
    mockStorageFactory = {
      create: jest.fn().mockReturnValue(mockStorage),
    };
    mockConfigService = createMockConfigService();

    useCase = new RestoreBackupUseCase(
      mockConfigLoader as unknown as ConfigLoaderPort,
      mockStorageFactory as unknown as RemoteStorageFactoryPort,
      mockConfigService as unknown as ConfigService,
    );

    fsMock.readdirSync.mockReturnValue([]);
    safeExecFileMock.mockResolvedValue({ stdout: '', stderr: '' });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── Full restore (no --only flag) ───────────────────────────────────

  it('full restore calls storage.restore without includePaths', async () => {
    const config = buildProjectConfig();
    mockConfigLoader.getProject.mockReturnValue(config);

    const command = new RestoreBackupCommand({
      projectName: 'test-project',
      snapshotId: 'abc123',
      targetPath: '/restore/output',
    });

    await useCase.execute(command);

    expect(mockStorageFactory.create).toHaveBeenCalledWith(config);
    expect(mockStorage.restore).toHaveBeenCalledTimes(1);
    expect(mockStorage.restore).toHaveBeenCalledWith('abc123', '/restore/output');
    expect(mockStorage.restore.mock.calls[0]).toHaveLength(2);
    expect(safeExecFileMock).not.toHaveBeenCalled();
  });

  // ── DB-only restore (--only db) ───────────────────────────────────────

  it('DB-only restore restores from outputDir', async () => {
    const config = buildProjectConfig();
    mockConfigLoader.getProject.mockReturnValue(config);

    const command = new RestoreBackupCommand({
      projectName: 'test-project',
      snapshotId: 'abc123',
      targetPath: '/restore/output',
      only: 'db',
    });

    await useCase.execute(command);

    const outputDir = '/data/backups/test-project';
    expect(mockStorage.restore).toHaveBeenCalledWith(
      'abc123',
      '/restore/output',
      [outputDir],
    );
  });

  // ── Assets-only restore (--only assets) ─────────────────────────────────

  it('assets-only restore restores from config.assets.paths', async () => {
    const config = buildProjectConfig({
      assets: { paths: ['/data/uploads', '/data/static'] },
    });
    mockConfigLoader.getProject.mockReturnValue(config);

    const command = new RestoreBackupCommand({
      projectName: 'test-project',
      snapshotId: 'abc123',
      targetPath: '/restore/output',
      only: 'assets',
    });

    await useCase.execute(command);

    expect(mockStorage.restore).toHaveBeenCalledWith(
      'abc123',
      '/restore/output',
      ['/data/uploads', '/data/static'],
    );
  });

  // ── Decompress option ─────────────────────────────────────────────────

  it('decompress runs gunzip on .gz files in target path', async () => {
    const config = buildProjectConfig();
    mockConfigLoader.getProject.mockReturnValue(config);
    (fsMock.readdirSync as jest.Mock).mockReturnValue([
      { name: 'dump.sql.gz', isDirectory: () => false },
      { name: 'other.sql.gz', isDirectory: () => false },
    ]);

    const command = new RestoreBackupCommand({
      projectName: 'test-project',
      snapshotId: 'abc123',
      targetPath: '/restore/output',
      decompress: true,
    });

    await useCase.execute(command);

    expect(fsMock.readdirSync).toHaveBeenCalledWith('/restore/output', { withFileTypes: true });
    expect(safeExecFileMock).toHaveBeenCalledTimes(2);
    expect(safeExecFileMock).toHaveBeenCalledWith('gunzip', ['/restore/output/dump.sql.gz']);
    expect(safeExecFileMock).toHaveBeenCalledWith('gunzip', ['/restore/output/other.sql.gz']);
  });

  it('decompress skips non-.gz files', async () => {
    const config = buildProjectConfig();
    mockConfigLoader.getProject.mockReturnValue(config);
    (fsMock.readdirSync as jest.Mock).mockReturnValue([
      { name: 'dump.sql.gz', isDirectory: () => false },
      { name: 'readme.txt', isDirectory: () => false },
      { name: 'schema.sql', isDirectory: () => false },
    ]);

    const command = new RestoreBackupCommand({
      projectName: 'test-project',
      snapshotId: 'abc123',
      targetPath: '/restore/output',
      decompress: true,
    });

    await useCase.execute(command);

    expect(safeExecFileMock).toHaveBeenCalledTimes(1);
    expect(safeExecFileMock).toHaveBeenCalledWith('gunzip', ['/restore/output/dump.sql.gz']);
  });

  it('skips decompress when decompress flag is false', async () => {
    const config = buildProjectConfig();
    mockConfigLoader.getProject.mockReturnValue(config);

    const command = new RestoreBackupCommand({
      projectName: 'test-project',
      snapshotId: 'abc123',
      targetPath: '/restore/output',
      decompress: false,
    });

    await useCase.execute(command);

    expect(fsMock.readdirSync).not.toHaveBeenCalled();
    expect(safeExecFileMock).not.toHaveBeenCalled();
  });

  // ── Error propagation ──────────────────────────────────────────────────

  it('propagates errors from storage.restore', async () => {
    const config = buildProjectConfig();
    mockConfigLoader.getProject.mockReturnValue(config);
    const restoreError = new Error('restic restore failed: snapshot not found');
    mockStorage.restore.mockRejectedValue(restoreError);

    const command = new RestoreBackupCommand({
      projectName: 'test-project',
      snapshotId: 'missing-snapshot',
      targetPath: '/restore/output',
    });

    await expect(useCase.execute(command)).rejects.toThrow(
      'restic restore failed: snapshot not found',
    );
    expect(fsMock.readdirSync).not.toHaveBeenCalled();
    expect(safeExecFileMock).not.toHaveBeenCalled();
  });

  it('propagates errors from safeExecFile during decompress', async () => {
    const config = buildProjectConfig();
    mockConfigLoader.getProject.mockReturnValue(config);
    (fsMock.readdirSync as jest.Mock).mockReturnValue([
      { name: 'dump.sql.gz', isDirectory: () => false },
    ]);
    safeExecFileMock.mockRejectedValue(new Error('gunzip failed: corrupted file'));

    const command = new RestoreBackupCommand({
      projectName: 'test-project',
      snapshotId: 'abc123',
      targetPath: '/restore/output',
      decompress: true,
    });

    await expect(useCase.execute(command)).rejects.toThrow('gunzip failed: corrupted file');
  });
});
