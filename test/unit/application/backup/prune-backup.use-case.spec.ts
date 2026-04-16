import { Logger } from '@nestjs/common';
import { PruneBackupUseCase } from '@domain/backup/application/use-cases/prune-backup/prune-backup.use-case';
import { PruneBackupCommand } from '@domain/backup/application/use-cases/prune-backup/prune-backup.command';
import { ConfigLoaderPort } from '@domain/config/application/ports/config-loader.port';
import { RemoteStorageFactoryPort } from '@domain/backup/application/ports/remote-storage-factory.port';
import { RemoteStoragePort } from '@domain/backup/application/ports/remote-storage.port';
import { PruneResult } from '@domain/backup/domain/value-objects/prune-result.model';
import { ProjectConfig } from '@domain/config/domain/project-config.model';
import { RetentionPolicy } from '@domain/config/domain/retention-policy.model';

describe('PruneBackupUseCase', () => {
  let useCase: PruneBackupUseCase;
  let mockStorageFactory: jest.Mocked<RemoteStorageFactoryPort>;
  let mockConfigLoader: jest.Mocked<ConfigLoaderPort>;
  let mockStorage: jest.Mocked<RemoteStoragePort>;
  let loggerErrorSpy: jest.SpyInstance;

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

    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    useCase = new PruneBackupUseCase(mockConfigLoader, mockStorageFactory);
  });

  afterEach(() => {
    loggerErrorSpy.mockRestore();
  });

  it('prune single project — creates storage from factory and prunes with retention', async () => {
    const config = createProjectConfig('my-project');
    mockConfigLoader.getProject.mockReturnValue(config);
    const pruneResult = new PruneResult(3, '250MB');
    mockStorage.prune.mockResolvedValue(pruneResult);

    const results = await useCase.execute(new PruneBackupCommand({ projectName: 'my-project' }));

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(pruneResult);
    expect(mockConfigLoader.getProject).toHaveBeenCalledWith('my-project');
    expect(mockStorageFactory.create).toHaveBeenCalledWith(config);
    expect(mockStorage.prune).toHaveBeenCalledWith(config.retention);
  });

  it('prune all enabled projects — iterates all enabled, returns all results', async () => {
    const projectA = createProjectConfig('project-a');
    const projectB = createProjectConfig('project-b');
    const projectC = createProjectConfig('project-c', false);
    mockConfigLoader.loadAll.mockReturnValue([projectA, projectB, projectC]);
    mockConfigLoader.getProject.mockImplementation((name: string) => {
      if (name === 'project-a') return projectA;
      return projectB;
    });

    const resultA = new PruneResult(2, '100MB');
    const resultB = new PruneResult(1, '50MB');
    mockStorage.prune.mockImplementation(async (_retention: unknown) => {
      const lastCall = mockConfigLoader.getProject.mock.calls[mockConfigLoader.getProject.mock.calls.length - 1];
      const projectName = lastCall?.[0];
      if (projectName === 'project-a') return resultA;
      return resultB;
    });

    const results = await useCase.execute(new PruneBackupCommand({ isAll: true }));

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual(resultA);
    expect(results[1]).toEqual(resultB);
    expect(mockStorageFactory.create).toHaveBeenCalledTimes(2);
    expect(mockStorage.prune).toHaveBeenCalledTimes(2);
  });

  it('prune all skips disabled projects', async () => {
    const enabledProject = createProjectConfig('enabled-project', true);
    const disabledProject = createProjectConfig('disabled-project', false);
    mockConfigLoader.loadAll.mockReturnValue([enabledProject, disabledProject]);
    mockConfigLoader.getProject.mockReturnValue(enabledProject);

    const pruneResult = new PruneResult(1, '10MB');
    mockStorage.prune.mockResolvedValue(pruneResult);

    const results = await useCase.execute(new PruneBackupCommand({ isAll: true }));

    expect(results).toHaveLength(1);
    expect(mockStorageFactory.create).toHaveBeenCalledTimes(1);
    expect(mockStorageFactory.create).toHaveBeenCalledWith(enabledProject);
  });

  it('prune all continues on individual failure (logs error, collects other results)', async () => {
    const projectA = createProjectConfig('project-a');
    const projectB = createProjectConfig('project-b');
    mockConfigLoader.loadAll.mockReturnValue([projectA, projectB]);
    mockConfigLoader.getProject.mockImplementation((name: string) => {
      if (name === 'project-a') return projectA;
      return projectB;
    });

    const resultB = new PruneResult(1, '50MB');
    mockStorage.prune
      .mockRejectedValueOnce(new Error('restic prune failed'))
      .mockResolvedValueOnce(resultB);

    const results = await useCase.execute(new PruneBackupCommand({ isAll: true }));

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(resultB);
    expect(loggerErrorSpy).toHaveBeenCalledWith('Prune failed for project-a: restic prune failed');
  });

  it('single prune throws when project not found', async () => {
    mockConfigLoader.getProject.mockImplementation(() => {
      throw new Error('Project "unknown" not found');
    });

    await expect(useCase.execute(new PruneBackupCommand({ projectName: 'unknown' }))).rejects.toThrow(
      'Project "unknown" not found',
    );

    expect(mockStorageFactory.create).not.toHaveBeenCalled();
    expect(mockStorage.prune).not.toHaveBeenCalled();
  });

  it('throws when neither projectName nor isAll provided', async () => {
    await expect(useCase.execute(new PruneBackupCommand({}))).rejects.toThrow(
      'Either projectName or isAll must be provided',
    );

    expect(mockConfigLoader.getProject).not.toHaveBeenCalled();
    expect(mockStorageFactory.create).not.toHaveBeenCalled();
  });
});
