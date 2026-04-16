import { ConnectNetworkUseCase } from '@domain/network/application/use-cases/connect-network/connect-network.use-case';
import { ConnectNetworkCommand } from '@domain/network/application/use-cases/connect-network/connect-network.command';
import { ConfigLoaderPort } from '@domain/config/application/ports/config-loader.port';
import { DockerNetworkPort } from '@domain/network/application/ports/docker-network.port';
import { ProjectConfig } from '@domain/config/domain/project-config.model';
import { RetentionPolicy } from '@domain/config/domain/retention-policy.model';
import { ConfigService } from '@nestjs/config';

describe('ConnectNetworkUseCase', () => {
  let useCase: ConnectNetworkUseCase;
  let mockConfigLoader: jest.Mocked<ConfigLoaderPort>;
  let mockDockerNetwork: jest.Mocked<DockerNetworkPort>;
  let mockConfigService: jest.Mocked<ConfigService>;

  const createProjectConfig = (name: string, dockerNetwork: string | null = null): ProjectConfig =>
    new ProjectConfig({
      name,
      enabled: true,
      cron: '0 2 * * *',
      timeoutMinutes: null,
      dockerNetwork,
      database: { type: 'postgres', host: 'postgres', port: 5432, name: 'db', user: 'u', password: 'p', dumpTimeoutMinutes: null },
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
    mockConfigLoader = {
      loadAll: jest.fn(),
      getProject: jest.fn(),
      validate: jest.fn(),
      reload: jest.fn(),
    };

    mockDockerNetwork = {
      connectContainer: jest.fn().mockResolvedValue(undefined),
      isContainerConnected: jest.fn().mockResolvedValue(false),
      networkExists: jest.fn().mockResolvedValue(true),
    };

    mockConfigService = {
      get: jest.fn().mockReturnValue('backupctl'),
    } as unknown as jest.Mocked<ConfigService>;

    useCase = new ConnectNetworkUseCase(mockConfigLoader, mockDockerNetwork, mockConfigService);
  });

  it('connects a single project to its docker network', async () => {
    const project = createProjectConfig('my-project', 'my-project_network');
    mockConfigLoader.getProject.mockReturnValue(project);

    const results = await useCase.execute(new ConnectNetworkCommand({ projectName: 'my-project' }));

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('connected');
    expect(results[0].networkName).toBe('my-project_network');
    expect(mockDockerNetwork.connectContainer).toHaveBeenCalledWith('backupctl', 'my-project_network');
  });

  it('connects all projects when no project name given', async () => {
    const projects = [
      createProjectConfig('proj-a', 'net-a'),
      createProjectConfig('proj-b', 'net-b'),
    ];
    mockConfigLoader.loadAll.mockReturnValue(projects);

    const results = await useCase.execute(new ConnectNetworkCommand({}));

    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('connected');
    expect(results[1].status).toBe('connected');
    expect(mockDockerNetwork.connectContainer).toHaveBeenCalledTimes(2);
  });

  it('skips projects without docker_network configured', async () => {
    const project = createProjectConfig('no-network');
    mockConfigLoader.getProject.mockReturnValue(project);

    const results = await useCase.execute(new ConnectNetworkCommand({ projectName: 'no-network' }));

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('skipped');
    expect(results[0].message).toBe('no docker_network configured');
    expect(mockDockerNetwork.connectContainer).not.toHaveBeenCalled();
  });

  it('returns already_connected when container is on the network', async () => {
    const project = createProjectConfig('my-project', 'my-network');
    mockConfigLoader.getProject.mockReturnValue(project);
    mockDockerNetwork.isContainerConnected.mockResolvedValue(true);

    const results = await useCase.execute(new ConnectNetworkCommand({ projectName: 'my-project' }));

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('already_connected');
    expect(mockDockerNetwork.connectContainer).not.toHaveBeenCalled();
  });

  it('returns failed when network does not exist', async () => {
    const project = createProjectConfig('my-project', 'missing-network');
    mockConfigLoader.getProject.mockReturnValue(project);
    mockDockerNetwork.networkExists.mockResolvedValue(false);

    const results = await useCase.execute(new ConnectNetworkCommand({ projectName: 'my-project' }));

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('failed');
    expect(results[0].message).toBe("network 'missing-network' does not exist");
  });

  it('returns failed when docker command throws', async () => {
    const project = createProjectConfig('my-project', 'my-network');
    mockConfigLoader.getProject.mockReturnValue(project);
    mockDockerNetwork.connectContainer.mockRejectedValue(new Error('permission denied'));

    const results = await useCase.execute(new ConnectNetworkCommand({ projectName: 'my-project' }));

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('failed');
    expect(results[0].message).toBe('permission denied');
  });

  it('uses custom container name from config', async () => {
    mockConfigService.get.mockReturnValue('custom-container');
    const project = createProjectConfig('my-project', 'my-network');
    mockConfigLoader.getProject.mockReturnValue(project);

    await useCase.execute(new ConnectNetworkCommand({ projectName: 'my-project' }));

    expect(mockDockerNetwork.connectContainer).toHaveBeenCalledWith('custom-container', 'my-network');
  });

  it('handles mixed results across multiple projects', async () => {
    const projects = [
      createProjectConfig('connected', 'net-a'),
      createProjectConfig('no-network'),
      createProjectConfig('failing', 'bad-net'),
    ];
    mockConfigLoader.loadAll.mockReturnValue(projects);
    mockDockerNetwork.networkExists
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const results = await useCase.execute(new ConnectNetworkCommand({}));

    expect(results).toHaveLength(3);
    expect(results[0].status).toBe('connected');
    expect(results[1].status).toBe('skipped');
    expect(results[2].status).toBe('failed');
  });
});
