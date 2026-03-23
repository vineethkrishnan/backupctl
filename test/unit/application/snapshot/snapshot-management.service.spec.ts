import { ListSnapshotsUseCase } from '@domain/backup/application/use-cases/list-snapshots/list-snapshots.use-case';
import { ListSnapshotsQuery } from '@domain/backup/application/use-cases/list-snapshots/list-snapshots.query';
import { ConfigLoaderPort } from '@domain/config/application/ports/config-loader.port';
import { RemoteStorageFactoryPort } from '@domain/backup/application/ports/remote-storage-factory.port';
import { RemoteStoragePort } from '@domain/backup/application/ports/remote-storage.port';
import { SnapshotInfo } from '@domain/backup/domain/value-objects/snapshot-info.model';
import { ProjectConfig } from '@domain/config/domain/project-config.model';
import { RetentionPolicy } from '@domain/config/domain/retention-policy.model';

describe('ListSnapshotsUseCase', () => {
  let service: ListSnapshotsUseCase;
  let mockStorageFactory: jest.Mocked<RemoteStorageFactoryPort>;
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
      monitor: null,
    });

    mockConfigLoader = {
      loadAll: jest.fn(),
      getProject: jest.fn().mockReturnValue(projectConfig),
      validate: jest.fn(),
      reload: jest.fn(),
    };

    service = new ListSnapshotsUseCase(mockStorageFactory, mockConfigLoader);
  });

  it('lists snapshots for a project', async () => {
    const snapshots = [
      createSnapshot('snap-1', '2026-03-18T02:00:00Z'),
      createSnapshot('snap-2', '2026-03-17T02:00:00Z'),
      createSnapshot('snap-3', '2026-03-16T02:00:00Z'),
    ];
    mockStorage.listSnapshots.mockResolvedValue(snapshots);

    const result = await service.execute(new ListSnapshotsQuery({ projectName: 'test-project' }));

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

    const result = await service.execute(new ListSnapshotsQuery({ projectName: 'test-project', limit: 2 }));

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('snap-1');
    expect(result[1].id).toBe('snap-2');
  });

  it('returns all snapshots when limit is not specified', async () => {
    const snapshots = [createSnapshot('snap-1', '2026-03-18T02:00:00Z')];
    mockStorage.listSnapshots.mockResolvedValue(snapshots);

    const result = await service.execute(new ListSnapshotsQuery({ projectName: 'test-project' }));

    expect(result).toHaveLength(1);
  });
});
