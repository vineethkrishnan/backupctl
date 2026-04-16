import { ResticCommand } from '@domain/backup/presenters/cli/restic.command';
import { ConfigLoaderPort } from '@domain/config/application/ports/config-loader.port';
import { RemoteStorageFactoryPort } from '@domain/backup/application/ports/remote-storage-factory.port';
import { RemoteStoragePort } from '@domain/backup/application/ports/remote-storage.port';
import { ProjectConfig } from '@domain/config/domain/project-config.model';
import { RetentionPolicy } from '@domain/config/domain/retention-policy.model';

function buildProjectConfig(): ProjectConfig {
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
      dumpTimeoutMinutes: null,
    },
    compression: { enabled: true },
    assets: { paths: [] },
    restic: {
      repositoryPath: '/backups/test',
      password: 'restic-pass',
      snapshotMode: 'combined',
    },
    retention: new RetentionPolicy(7, 7, 4),
    encryption: null,
    hooks: null,
    verification: { enabled: false },
    notification: null,
    monitor: null,
  });
}

describe('ResticCommand', () => {
  let command: ResticCommand;
  let configLoader: jest.Mocked<ConfigLoaderPort>;
  let storageFactory: jest.Mocked<RemoteStorageFactoryPort>;
  let storage: jest.Mocked<RemoteStoragePort>;

  beforeEach(() => {
    storage = {
      exec: jest.fn(),
    } as unknown as jest.Mocked<RemoteStoragePort>;

    configLoader = {
      getProject: jest.fn(),
    } as unknown as jest.Mocked<ConfigLoaderPort>;

    storageFactory = {
      create: jest.fn().mockReturnValue(storage),
    } as unknown as jest.Mocked<RemoteStorageFactoryPort>;

    command = new ResticCommand(configLoader, storageFactory);
    process.exitCode = undefined;
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('should pass through restic args to exec', async () => {
    configLoader.getProject.mockReturnValue(buildProjectConfig());
    storage.exec.mockResolvedValue('snapshot abc123 saved');

    await command.run(['test-project', 'snapshots', '--json']);

    expect(configLoader.getProject).toHaveBeenCalledWith('test-project');
    expect(storageFactory.create).toHaveBeenCalled();
    expect(storage.exec).toHaveBeenCalledWith(['snapshots', '--json']);
  });

  it('should output stdout from restic', async () => {
    configLoader.getProject.mockReturnValue(buildProjectConfig());
    storage.exec.mockResolvedValue('repository abc opened\n3 snapshots');

    await command.run(['test-project', 'stats']);

    expect(console.log).toHaveBeenCalledWith('repository abc opened\n3 snapshots');
  });

  it('should set exit code 1 when no args provided', async () => {
    await command.run([]);

    expect(process.exitCode).toBe(1);
  });

  it('should set exit code 1 when only project provided without command', async () => {
    await command.run(['test-project']);

    expect(process.exitCode).toBe(1);
  });

  it('should set exit code 1 on error', async () => {
    configLoader.getProject.mockReturnValue(buildProjectConfig());
    storage.exec.mockRejectedValue(new Error('restic: command failed'));

    await command.run(['test-project', 'check']);

    expect(process.exitCode).toBe(1);
  });
});
