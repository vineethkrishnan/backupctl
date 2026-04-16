import { ConfigService } from '@nestjs/config';
import { ResticStorageFactory } from '@domain/backup/infrastructure/adapters/storage/restic-storage.factory';
import { ProjectConfig } from '@domain/config/domain/project-config.model';
import { RetentionPolicy } from '@domain/config/domain/retention-policy.model';

describe('ResticStorageFactory', () => {
  let factory: ResticStorageFactory;
  let configValues: Record<string, unknown>;

  beforeEach(() => {
    configValues = {
      HETZNER_SSH_HOST: 'storage.example.com',
      HETZNER_SSH_USER: 'u123',
      HETZNER_SSH_KEY_PATH: '/home/node/.ssh/id_ed25519',
      HETZNER_SSH_PORT: 23,
      RESTIC_PASSWORD: 'global-pass',
    };

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: unknown) => configValues[key] ?? defaultValue),
      getOrThrow: jest.fn((key: string) => {
        if (configValues[key] === undefined) throw new Error(`Config key "${key}" not found`);
        return configValues[key];
      }),
    } as unknown as ConfigService;

    factory = new ResticStorageFactory(mockConfigService);
  });

  function buildConfig(overrides: Partial<{ resticPassword: string; repoPath: string }> = {}): ProjectConfig {
    return new ProjectConfig({
      name: 'test-project',
      enabled: true,
      cron: '0 2 * * *',
      timeoutMinutes: null,
      database: { type: 'postgres', host: 'db', port: 5432, name: 'testdb', user: 'u', password: 'p', dumpTimeoutMinutes: null },
      compression: { enabled: true },
      assets: { paths: [] },
      restic: {
        repositoryPath: overrides.repoPath ?? 'backups/test-project',
        password: overrides.resticPassword ?? '',
        snapshotMode: 'combined',
      },
      retention: new RetentionPolicy(7, 7, 4, 3),
      encryption: null,
      hooks: null,
      verification: { enabled: false },
      notification: null,
      monitor: null,
    });
  }

  it('creates a RemoteStoragePort instance', () => {
    const storage = factory.create(buildConfig());
    expect(storage).toBeDefined();
    expect(typeof storage.sync).toBe('function');
    expect(typeof storage.prune).toBe('function');
  });

  it('uses project-level restic password over global', () => {
    const config = buildConfig({ resticPassword: 'project-pass' });
    const storage = factory.create(config);
    expect(storage).toBeDefined();
  });

  it('falls back to global RESTIC_PASSWORD when project password is empty', () => {
    const config = buildConfig({ resticPassword: '' });
    const storage = factory.create(config);
    expect(storage).toBeDefined();
  });

  it('throws when required SSH config is missing', () => {
    configValues['HETZNER_SSH_HOST'] = undefined;
    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: unknown) => configValues[key] ?? defaultValue),
      getOrThrow: jest.fn((key: string) => {
        if (configValues[key] === undefined) throw new Error(`Config key "${key}" not found`);
        return configValues[key];
      }),
    } as unknown as ConfigService;

    const brokenFactory = new ResticStorageFactory(mockConfigService);
    expect(() => brokenFactory.create(buildConfig())).toThrow('Config key "HETZNER_SSH_HOST" not found');
  });
});
