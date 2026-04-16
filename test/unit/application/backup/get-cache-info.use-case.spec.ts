import { GetCacheInfoUseCase } from '@domain/backup/application/use-cases/get-cache-info/get-cache-info.use-case';
import { GetCacheInfoQuery } from '@domain/backup/application/use-cases/get-cache-info/get-cache-info.query';
import { ConfigLoaderPort } from '@domain/config/application/ports/config-loader.port';
import { RemoteStorageFactoryPort } from '@domain/backup/application/ports/remote-storage-factory.port';
import { RemoteStoragePort } from '@domain/backup/application/ports/remote-storage.port';
import { CacheInfo } from '@domain/backup/domain/value-objects/cache-info.model';
import { ProjectConfig } from '@domain/config/domain/project-config.model';
import { RetentionPolicy } from '@domain/config/domain/retention-policy.model';

describe('GetCacheInfoUseCase', () => {
  let useCase: GetCacheInfoUseCase;
  let mockStorageFactory: jest.Mocked<RemoteStorageFactoryPort>;
  let mockConfigLoader: jest.Mocked<ConfigLoaderPort>;
  let mockStorage: jest.Mocked<RemoteStoragePort>;

  const createProjectConfig = (name: string, enabled = true): ProjectConfig =>
    new ProjectConfig({
      name,
      enabled,
      cron: '0 2 * * *',
      timeoutMinutes: null,
      database: { type: 'postgres', host: 'localhost', port: 5432, name: 'db', user: 'u', password: 'p', dumpTimeoutMinutes: null },
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

    mockConfigLoader = {
      loadAll: jest.fn(),
      getProject: jest.fn().mockReturnValue(createProjectConfig('test-project')),
      validate: jest.fn(),
      reload: jest.fn(),
    };

    useCase = new GetCacheInfoUseCase(mockStorageFactory, mockConfigLoader);
  });

  it('delegates to storage adapter', async () => {
    const cacheInfo = new CacheInfo('test-project', 1024 * 1024, '/cache/test-project');
    mockStorage.getCacheInfo.mockResolvedValue(cacheInfo);

    const result = await useCase.execute(new GetCacheInfoQuery({ projectName: 'test-project' }));

    expect(mockConfigLoader.getProject).toHaveBeenCalledWith('test-project');
    expect(mockStorageFactory.create).toHaveBeenCalled();
    expect(result).toBe(cacheInfo);
  });
});
