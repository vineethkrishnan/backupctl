import { CacheManagementService } from '@application/backup/cache-management.service';
import { ConfigLoaderPort } from '@domain/config/ports/config-loader.port';
import { RemoteStorageFactory } from '@domain/backup/ports/remote-storage-factory.port';
import { RemoteStoragePort } from '@domain/backup/ports/remote-storage.port';
import { CacheInfo } from '@domain/backup/models/cache-info.model';
import { ProjectConfig } from '@domain/config/models/project-config.model';
import { RetentionPolicy } from '@domain/config/models/retention-policy.model';

describe('CacheManagementService', () => {
  let service: CacheManagementService;
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

    service = new CacheManagementService(mockStorageFactory, mockConfigLoader);
  });

  describe('getCacheInfo', () => {
    it('delegates to storage adapter', async () => {
      const cacheInfo = new CacheInfo('test-project', 1024 * 1024, '/cache/test-project');
      mockStorage.getCacheInfo.mockResolvedValue(cacheInfo);

      const result = await service.getCacheInfo('test-project');

      expect(mockConfigLoader.getProject).toHaveBeenCalledWith('test-project');
      expect(mockStorageFactory.create).toHaveBeenCalled();
      expect(result).toBe(cacheInfo);
    });
  });

  describe('clearCache', () => {
    it('delegates to storage adapter', async () => {
      mockStorage.clearCache.mockResolvedValue(undefined);

      await service.clearCache('test-project');

      expect(mockConfigLoader.getProject).toHaveBeenCalledWith('test-project');
      expect(mockStorage.clearCache).toHaveBeenCalled();
    });
  });

  describe('clearAllCaches', () => {
    it('iterates all enabled projects and clears cache', async () => {
      const projects = [
        createProjectConfig('project-a', true),
        createProjectConfig('project-b', true),
        createProjectConfig('project-c', false),
      ];
      mockConfigLoader.loadAll.mockReturnValue(projects);
      mockStorage.clearCache.mockResolvedValue(undefined);

      await service.clearAllCaches();

      // Only enabled projects (a and b) should have clearCache called
      expect(mockStorageFactory.create).toHaveBeenCalledTimes(2);
      expect(mockStorage.clearCache).toHaveBeenCalledTimes(2);
    });
  });
});
