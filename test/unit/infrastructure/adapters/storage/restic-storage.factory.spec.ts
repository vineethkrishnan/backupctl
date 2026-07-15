import { ConfigService } from '@nestjs/config';
import { ResticStorageFactory } from '@domain/backup/infrastructure/adapters/storage/restic-storage.factory';
import { ProjectConfig } from '@domain/config/domain/project-config.model';
import { RetentionPolicy } from '@domain/config/domain/retention-policy.model';
import { buildProjectConfig } from '@test/support/project-config.builder';

jest.mock('@common/helpers/child-process.util');
import { safeExecFile } from '@common/helpers/child-process.util';

const mockedSafeExecFile = safeExecFile as jest.MockedFunction<typeof safeExecFile>;

describe('ResticStorageFactory', () => {
  let factory: ResticStorageFactory;
  let configValues: Record<string, unknown>;

  function createFactory(): ResticStorageFactory {
    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: unknown) => configValues[key] ?? defaultValue),
      getOrThrow: jest.fn((key: string) => {
        if (configValues[key] === undefined) throw new Error(`Config key "${key}" not found`);
        return configValues[key];
      }),
    } as unknown as ConfigService;

    return new ResticStorageFactory(mockConfigService);
  }

  beforeEach(() => {
    mockedSafeExecFile.mockReset();
    mockedSafeExecFile.mockResolvedValue({ stdout: '', stderr: '' });

    configValues = {
      HETZNER_SSH_HOST: 'storage.example.com',
      HETZNER_SSH_USER: 'u123',
      HETZNER_SSH_KEY_PATH: '/home/node/.ssh/id_ed25519',
      HETZNER_SSH_PORT: 23,
      RESTIC_PASSWORD: 'global-pass',
    };

    factory = createFactory();
  });

  function buildConfig(overrides: Partial<{ resticPassword: string; repoPath: string }> = {}): ProjectConfig {
    return buildProjectConfig({
      storage: {
        type: 'sftp',
        repository: overrides.repoPath ?? '/backups/test-project',
        password: overrides.resticPassword ?? '',
        snapshotMode: 'combined',
        config: {},
      },
      retention: new RetentionPolicy(7, 7, 4, 3),
    });
  }

  async function envFromCreatedStorage(config: ProjectConfig): Promise<Record<string, string>> {
    const storage = factory.create(config);
    await storage.unlock();
    return mockedSafeExecFile.mock.calls[0]![2]!.env as Record<string, string>;
  }

  it('creates a RemoteStoragePort instance', () => {
    const storage = factory.create(buildConfig());
    expect(typeof storage.sync).toBe('function');
    expect(typeof storage.prune).toBe('function');
  });

  it('builds the sftp repository URL from SSH config and repository path', async () => {
    const env = await envFromCreatedStorage(buildConfig({ repoPath: '/backups/vinsware' }));

    expect(env.RESTIC_REPOSITORY).toBe('sftp:u123@storage.example.com:/backups/vinsware');
  });

  it('builds the SSH command with the key path and port', async () => {
    const env = await envFromCreatedStorage(buildConfig());

    expect(env.RESTIC_SSH_COMMAND).toBe(
      'ssh -i "/home/node/.ssh/id_ed25519" -p 23 -o StrictHostKeyChecking=accept-new',
    );
  });

  it('defaults the SSH port to 22 when not configured', async () => {
    delete configValues['HETZNER_SSH_PORT'];
    factory = createFactory();

    const env = await envFromCreatedStorage(buildConfig());

    expect(env.RESTIC_SSH_COMMAND).toContain('-p 22');
  });

  it('uses project-level restic password over global', async () => {
    const env = await envFromCreatedStorage(buildConfig({ resticPassword: 'project-pass' }));

    expect(env.RESTIC_PASSWORD).toBe('project-pass');
  });

  it('falls back to global RESTIC_PASSWORD when project password is empty', async () => {
    const env = await envFromCreatedStorage(buildConfig({ resticPassword: '' }));

    expect(env.RESTIC_PASSWORD).toBe('global-pass');
  });

  it('throws when no password is configured at either level', () => {
    delete configValues['RESTIC_PASSWORD'];
    factory = createFactory();

    expect(() => factory.create(buildConfig({ resticPassword: '' }))).toThrow(
      'Restic password not configured for project "test-project"',
    );
  });

  it('throws when required SSH config is missing', () => {
    configValues['HETZNER_SSH_HOST'] = undefined;
    factory = createFactory();

    expect(() => factory.create(buildConfig())).toThrow('Config key "HETZNER_SSH_HOST" not found');
  });
});
