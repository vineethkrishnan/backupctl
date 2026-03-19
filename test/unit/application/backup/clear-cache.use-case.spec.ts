import { ClearCacheUseCase } from '@domain/backup/application/use-cases/clear-cache/clear-cache.use-case';
import { ClearCacheCommand } from '@domain/backup/application/use-cases/clear-cache/clear-cache.command';
import { ConfigLoaderPort } from '@domain/config/application/ports/config-loader.port';
import { RemoteStorageFactory } from '@domain/backup/application/ports/remote-storage-factory.port';
import { RemoteStoragePort } from '@domain/backup/application/ports/remote-storage.port';
import { ProjectConfig } from '@domain/config/domain/project-config.model';
import { RetentionPolicy } from '@domain/config/domain/retention-policy.model';

describe('ClearCacheUseCase', () => {
  let useCase: ClearCacheUseCase;
  let mockStorageFactory: jest.Mocked<RemoteStorageFactory>;
  let mockConfigLoader: jest.Mocked<ConfigLoaderPort>;
  let mockStorage: jest.Mocked<RemoteStoragePort>;

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

  beforeEach(() => {
    mockStorage = {
      sync: jest.fn(),
      prune: jest.fn(),
      listSnapshots: jest.fn(),
      restore: jest.fn(),
      exec: jest.fn(),
      getCacheInfo: jest.fn(),
      clearCache: jest.fn().mockResolvedValue(undefined),
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

    useCase = new ClearCacheUseCase(mockStorageFactory, mockConfigLoader);
  });

  it('delegates to storage adapter for single project', async () => {
    await useCase.execute(new ClearCacheCommand({ projectName: 'test-project' }));

    expect(mockConfigLoader.getProject).toHaveBeenCalledWith('test-project');
    expect(mockStorage.clearCache).toHaveBeenCalled();
  });

  it('iterates all enabled projects when clearAll is true', async () => {
    const projects = [
      createProjectConfig('project-a', true),
      createProjectConfig('project-b', true),
      createProjectConfig('project-c', false),
    ];
    mockConfigLoader.loadAll.mockReturnValue(projects);

    await useCase.execute(new ClearCacheCommand({ clearAll: true }));

    expect(mockStorageFactory.create).toHaveBeenCalledTimes(2);
    expect(mockStorage.clearCache).toHaveBeenCalledTimes(2);
  });

  it('throws when projectName missing and clearAll is false', async () => {
    await expect(useCase.execute(new ClearCacheCommand({}))).rejects.toThrow(
      'projectName is required when clearAll is false',
    );
  });
});
