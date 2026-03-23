import {
  ConfigCommand,
  ConfigValidateSubCommand,
  ConfigShowSubCommand,
  ConfigReloadSubCommand,
  ConfigImportGpgKeySubCommand,
} from '@domain/config/presenters/cli/config.command';
import { ConfigLoaderPort } from '@domain/config/application/ports/config-loader.port';
import { ProjectConfig } from '@domain/config/domain/project-config.model';
import { RetentionPolicy } from '@domain/config/domain/retention-policy.model';
import { GpgKeyManagerAdapter as GpgKeyManager } from '@domain/backup/infrastructure/adapters/encryptors/gpg-key-manager.adapter';

function buildProjectConfig(): ProjectConfig {
  return new ProjectConfig({
    name: 'test-project',
    enabled: true,
    cron: '0 2 * * *',
    timeoutMinutes: 60,
    database: {
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      name: 'testdb',
      user: 'admin',
      password: 'super-secret',
    },
    compression: { enabled: true },
    assets: { paths: ['/data/uploads'] },
    restic: {
      repositoryPath: '/backups/test',
      password: 'restic-secret',
      snapshotMode: 'combined',
    },
    retention: new RetentionPolicy(7, 7, 4),
    encryption: null,
    hooks: null,
    verification: { enabled: true },
    notification: { type: 'slack', config: {} },
    monitor: null,
  });
}

describe('ConfigValidateSubCommand', () => {
  let command: ConfigValidateSubCommand;
  let configLoader: jest.Mocked<ConfigLoaderPort>;

  beforeEach(() => {
    configLoader = {
      validate: jest.fn(),
    } as unknown as jest.Mocked<ConfigLoaderPort>;

    command = new ConfigValidateSubCommand(configLoader);
    process.exitCode = undefined;
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('should print valid when config is correct', async () => {
    configLoader.validate.mockReturnValue({ isValid: true, errors: [] });

    await command.run([]);

    expect(console.log).toHaveBeenCalledWith('Configuration is valid.');
    expect(process.exitCode).toBeUndefined();
  });

  it('should set exit code 3 when config is invalid', async () => {
    configLoader.validate.mockReturnValue({
      isValid: false,
      errors: ['Missing database host', 'Invalid cron expression'],
    });

    await command.run([]);

    expect(process.exitCode).toBe(3);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Missing database host'));
  });
});

describe('ConfigShowSubCommand', () => {
  let command: ConfigShowSubCommand;
  let configLoader: jest.Mocked<ConfigLoaderPort>;

  beforeEach(() => {
    configLoader = {
      getProject: jest.fn(),
    } as unknown as jest.Mocked<ConfigLoaderPort>;

    command = new ConfigShowSubCommand(configLoader);
    process.exitCode = undefined;
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('should print masked config for project', async () => {
    configLoader.getProject.mockReturnValue(buildProjectConfig());

    await command.run(['test-project']);

    expect(configLoader.getProject).toHaveBeenCalledWith('test-project');

    const output = (console.log as jest.Mock).mock.calls[0][0] as string;
    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect((parsed.database as Record<string, unknown>).password).toBe('********');
    expect((parsed.restic as Record<string, unknown>).password).toBe('********');
  });

  it('should print null database for files-only project', async () => {
    const filesOnlyConfig = new ProjectConfig({
      name: 'static-assets',
      enabled: true,
      cron: '0 3 * * *',
      timeoutMinutes: null,
      database: null,
      compression: { enabled: true },
      assets: { paths: ['/data/uploads'] },
      restic: { repositoryPath: '/backups/test', password: 'restic-secret', snapshotMode: 'combined' },
      retention: new RetentionPolicy(7, 7, 4),
      encryption: null,
      hooks: null,
      verification: { enabled: false },
      notification: null,
      monitor: null,
    });
    configLoader.getProject.mockReturnValue(filesOnlyConfig);

    await command.run(['static-assets']);

    const output = (console.log as jest.Mock).mock.calls[0][0] as string;
    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(parsed.database).toBeNull();
  });

  it('should set exit code 1 for unknown project', async () => {
    configLoader.getProject.mockImplementation(() => {
      throw new Error('Project "unknown" not found');
    });

    await command.run(['unknown']);

    expect(process.exitCode).toBe(1);
  });
});

describe('ConfigReloadSubCommand', () => {
  let command: ConfigReloadSubCommand;
  let configLoader: jest.Mocked<ConfigLoaderPort>;

  beforeEach(() => {
    configLoader = {
      reload: jest.fn(),
    } as unknown as jest.Mocked<ConfigLoaderPort>;

    command = new ConfigReloadSubCommand(configLoader);
    process.exitCode = undefined;
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('should call reload and confirm', async () => {
    await command.run([]);

    expect(configLoader.reload).toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith('Configuration reloaded successfully.');
  });

  it('should set exit code 1 on reload error', async () => {
    configLoader.reload.mockImplementation(() => {
      throw new Error('YAML parse error');
    });

    await command.run([]);

    expect(process.exitCode).toBe(1);
  });
});

describe('ConfigImportGpgKeySubCommand', () => {
  let command: ConfigImportGpgKeySubCommand;
  let gpgKeyManager: jest.Mocked<GpgKeyManager>;

  beforeEach(() => {
    gpgKeyManager = {
      importKey: jest.fn(),
    } as unknown as jest.Mocked<GpgKeyManager>;

    command = new ConfigImportGpgKeySubCommand(gpgKeyManager);
    process.exitCode = undefined;
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('should call importKey with file path', async () => {
    gpgKeyManager.importKey.mockResolvedValue();

    await command.run(['/keys/backup.gpg']);

    expect(gpgKeyManager.importKey).toHaveBeenCalledWith('/keys/backup.gpg');
    expect(console.log).toHaveBeenCalledWith('GPG key imported from /keys/backup.gpg.');
  });

  it('should set exit code 1 on import failure', async () => {
    gpgKeyManager.importKey.mockRejectedValue(new Error('GPG import failed'));

    await command.run(['/keys/bad.gpg']);

    expect(process.exitCode).toBe(1);
  });
});

describe('ConfigCommand', () => {
  it('should print usage message', async () => {
    jest.spyOn(console, 'log').mockImplementation();
    const cmd = new ConfigCommand();

    await cmd.run([]);

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Usage: backupctl config'),
    );
    jest.restoreAllMocks();
  });
});
