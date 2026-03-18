import { SnapshotManagementService } from '@application/snapshot/snapshot-management.service';
import { ConfigLoaderPort } from '@domain/config/ports/config-loader.port';
import { RemoteStorageFactory } from '@domain/backup/ports/remote-storage-factory.port';
import { RemoteStoragePort } from '@domain/backup/ports/remote-storage.port';
import { SnapshotInfo } from '@domain/backup/models/snapshot-info.model';
import { ProjectConfig } from '@domain/config/models/project-config.model';
import { RetentionPolicy } from '@domain/config/models/retention-policy.model';

describe('SnapshotManagementService', () => {
  let service: SnapshotManagementService;
  let mockStorageFactory: jest.Mocked<RemoteStorageFactory>;
  let mockConfigLoader: jest.Mocked<ConfigLoaderPort>;
  let mockStorage: jest.Mocked<RemoteStoragePort>;
  let projectConfig: ProjectConfig;

  const createSnapshot = (id: string, time: string): SnapshotInfo =>
    new SnapshotInfo(id, time, ['/data/backups/test'], 'host', ['db'], '100MB');

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

    mockStorageFactory = {
      create: jest.fn().mockReturnValue(mockStorage),
    };

    projectConfig = new ProjectConfig({
      name: 'test-project',
      enabled: true,
      cron: '0 2 * * *',
      timeoutMinutes: null,
      database: { type: 'postgres', host: 'localhost', port: 5432, name: 'testdb', user: 'user', password: 'pass' },
      compression: { enabled: true },
      assets: { paths: [] },
      restic: { repositoryPath: '/repo', password: 'secret', snapshotMode: 'combined' },
      retention: new RetentionPolicy(7, 7, 4, 6),
      encryption: null,
      hooks: null,
      verification: { enabled: false },
      notification: null,
    });

    mockConfigLoader = {
      loadAll: jest.fn(),
      getProject: jest.fn().mockReturnValue(projectConfig),
      validate: jest.fn(),
      reload: jest.fn(),
    };

    service = new SnapshotManagementService(mockStorageFactory, mockConfigLoader);
  });

  it('lists snapshots for a project', async () => {
    const snapshots = [
      createSnapshot('snap-1', '2026-03-18T02:00:00Z'),
      createSnapshot('snap-2', '2026-03-17T02:00:00Z'),
      createSnapshot('snap-3', '2026-03-16T02:00:00Z'),
    ];
    mockStorage.listSnapshots.mockResolvedValue(snapshots);

    const result = await service.listSnapshots('test-project');

    expect(mockConfigLoader.getProject).toHaveBeenCalledWith('test-project');
    expect(mockStorageFactory.create).toHaveBeenCalledWith(projectConfig);
    expect(result).toHaveLength(3);
    expect(result).toEqual(snapshots);
  });

  it('applies limit when specified', async () => {
    const snapshots = [
      createSnapshot('snap-1', '2026-03-18T02:00:00Z'),
      createSnapshot('snap-2', '2026-03-17T02:00:00Z'),
      createSnapshot('snap-3', '2026-03-16T02:00:00Z'),
    ];
    mockStorage.listSnapshots.mockResolvedValue(snapshots);

    const result = await service.listSnapshots('test-project', 2);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('snap-1');
    expect(result[1].id).toBe('snap-2');
  });

  it('returns all snapshots when limit is not specified', async () => {
    const snapshots = [createSnapshot('snap-1', '2026-03-18T02:00:00Z')];
    mockStorage.listSnapshots.mockResolvedValue(snapshots);

    const result = await service.listSnapshots('test-project');

    expect(result).toHaveLength(1);
  });
});
