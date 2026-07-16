import { ConfigService } from '@nestjs/config';
import { ResticStorageFactory } from '@domain/backup/infrastructure/adapters/storage/restic-storage.factory';
import { ResticBackendRegistry } from '@domain/backup/infrastructure/adapters/storage/backends/restic-backend.registry';
import { SftpBackendResolver } from '@domain/backup/infrastructure/adapters/storage/backends/sftp-backend.resolver';
import { S3BackendResolver } from '@domain/backup/infrastructure/adapters/storage/backends/s3-backend.resolver';
import { B2BackendResolver } from '@domain/backup/infrastructure/adapters/storage/backends/b2-backend.resolver';
import { RcloneBackendResolver } from '@domain/backup/infrastructure/adapters/storage/backends/rclone-backend.resolver';
import { LocalBackendResolver } from '@domain/backup/infrastructure/adapters/storage/backends/local-backend.resolver';
import { ProjectConfig } from '@domain/config/domain/project-config.model';
import { RetentionPolicy } from '@domain/config/domain/retention-policy.model';
import { StorageConfig } from '@domain/config/domain/storage-config.model';
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

    const registry = new ResticBackendRegistry(
      new SftpBackendResolver(mockConfigService),
      new S3BackendResolver(),
      new B2BackendResolver(),
      new RcloneBackendResolver(mockConfigService),
      new LocalBackendResolver(),
    );

    return new ResticStorageFactory(mockConfigService, registry);
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

  function buildStorageConfig(storage: Partial<StorageConfig>): ProjectConfig {
    return buildProjectConfig({
      storage: {
        type: 'sftp',
        repository: '/backups/test-project',
        password: 'restic-pass',
        snapshotMode: 'combined',
        config: {},
        ...storage,
      },
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

  describe('s3 backend', () => {
    const s3Config = {
      type: 's3' as const,
      repository: 'my-bucket/vinsware',
      config: {
        endpoint: 'https://s3.eu-central-003.backblazeb2.com',
        access_key_id: 'key-id',
        secret_access_key: 'secret-key',
      },
    };

    it('builds the s3 repository URL and credential env', async () => {
      const env = await envFromCreatedStorage(buildStorageConfig(s3Config));

      expect(env.RESTIC_REPOSITORY).toBe('s3:https://s3.eu-central-003.backblazeb2.com/my-bucket/vinsware');
      expect(env.AWS_ACCESS_KEY_ID).toBe('key-id');
      expect(env.AWS_SECRET_ACCESS_KEY).toBe('secret-key');
    });

    it('does not leak the SSH command into a non-sftp backend', async () => {
      const env = await envFromCreatedStorage(buildStorageConfig(s3Config));

      expect(env.RESTIC_SSH_COMMAND).toBeUndefined();
    });

    it('does not require Hetzner SSH config', async () => {
      delete configValues['HETZNER_SSH_HOST'];
      delete configValues['HETZNER_SSH_USER'];
      delete configValues['HETZNER_SSH_KEY_PATH'];
      factory = createFactory();

      const env = await envFromCreatedStorage(buildStorageConfig(s3Config));

      expect(env.RESTIC_REPOSITORY).toContain('s3:');
    });

    it('tolerates a leading slash on the repository, as carried over from an sftp config', async () => {
      const env = await envFromCreatedStorage(buildStorageConfig({ ...s3Config, repository: '/my-bucket/vinsware' }));

      expect(env.RESTIC_REPOSITORY).toBe('s3:https://s3.eu-central-003.backblazeb2.com/my-bucket/vinsware');
    });

    it('strips a trailing slash from the endpoint', async () => {
      const env = await envFromCreatedStorage(
        buildStorageConfig({ ...s3Config, config: { ...s3Config.config, endpoint: 'https://s3.example.com/' } }),
      );

      expect(env.RESTIC_REPOSITORY).toBe('s3:https://s3.example.com/my-bucket/vinsware');
    });

    it('passes region through when configured', async () => {
      const env = await envFromCreatedStorage(
        buildStorageConfig({ ...s3Config, config: { ...s3Config.config, region: 'eu-central-1' } }),
      );

      expect(env.AWS_DEFAULT_REGION).toBe('eu-central-1');
    });

    it('omits region when not configured', async () => {
      const env = await envFromCreatedStorage(buildStorageConfig(s3Config));

      expect(env.AWS_DEFAULT_REGION).toBeUndefined();
    });

    it('throws with an actionable message when credentials are missing', () => {
      const config = buildStorageConfig({ ...s3Config, config: { endpoint: 'https://s3.example.com' } });

      expect(() => factory.create(config)).toThrow('requires config.access_key_id');
    });
  });

  describe('b2 backend', () => {
    it('builds the b2 repository and credential env', async () => {
      const env = await envFromCreatedStorage(
        buildStorageConfig({
          type: 'b2',
          repository: 'my-bucket:vinsware',
          config: { account_id: 'acct', account_key: 'acct-key' },
        }),
      );

      expect(env.RESTIC_REPOSITORY).toBe('b2:my-bucket:vinsware');
      expect(env.B2_ACCOUNT_ID).toBe('acct');
      expect(env.B2_ACCOUNT_KEY).toBe('acct-key');
    });

    it('rejects the s3-style bucket/path form, which b2 does not accept', () => {
      const config = buildStorageConfig({
        type: 'b2',
        repository: 'my-bucket/vinsware',
        config: { account_id: 'acct', account_key: 'acct-key' },
      });

      expect(() => factory.create(config)).toThrow('is not a valid b2 target');
    });
  });

  describe('rclone backend', () => {
    it('builds the rclone repository from a remote:path target', async () => {
      const env = await envFromCreatedStorage(
        buildStorageConfig({ type: 'rclone', repository: 'gdrive:backups/vinsware' }),
      );

      expect(env.RESTIC_REPOSITORY).toBe('rclone:gdrive:backups/vinsware');
    });

    it('sets RCLONE_CONFIG from the project config bag', async () => {
      const env = await envFromCreatedStorage(
        buildStorageConfig({
          type: 'rclone',
          repository: 'gdrive:backups/vinsware',
          config: { config_path: '/custom/rclone.conf' },
        }),
      );

      expect(env.RCLONE_CONFIG).toBe('/custom/rclone.conf');
    });

    it('falls back to RCLONE_CONFIG_PATH from env', async () => {
      configValues['RCLONE_CONFIG_PATH'] = '/home/node/.config/rclone/rclone.conf';
      factory = createFactory();

      const env = await envFromCreatedStorage(
        buildStorageConfig({ type: 'rclone', repository: 'gdrive:backups/vinsware' }),
      );

      expect(env.RCLONE_CONFIG).toBe('/home/node/.config/rclone/rclone.conf');
    });

    it('leaves RCLONE_CONFIG unset so rclone uses its default path', async () => {
      const env = await envFromCreatedStorage(
        buildStorageConfig({ type: 'rclone', repository: 'gdrive:backups/vinsware' }),
      );

      expect(env.RCLONE_CONFIG).toBeUndefined();
    });

    it('rejects a repository that is not a remote:path target', () => {
      const config = buildStorageConfig({ type: 'rclone', repository: 'backups/vinsware' });

      expect(() => factory.create(config)).toThrow('is not a valid rclone target');
    });
  });

  describe('local backend', () => {
    it('uses the repository path verbatim with no extra env', async () => {
      const env = await envFromCreatedStorage(
        buildStorageConfig({ type: 'local', repository: '/srv/restic-repo' }),
      );

      expect(env.RESTIC_REPOSITORY).toBe('/srv/restic-repo');
      expect(env.RESTIC_SSH_COMMAND).toBeUndefined();
    });
  });
});
