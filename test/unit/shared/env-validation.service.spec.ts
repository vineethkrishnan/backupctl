import { ConfigService } from '@nestjs/config';
import { EnvValidationService } from '@common/validation/env-validation.service';
import { ConfigLoaderPort } from '@domain/config/application/ports/config-loader.port';
import { StorageBackendType } from '@domain/config/domain/storage-config.model';
import { buildProjectConfig } from '@test/support/project-config.builder';

function createConfigService(env: Record<string, string>): ConfigService {
  return {
    get: jest.fn((key: string) => env[key] ?? undefined),
  } as unknown as ConfigService;
}

function createConfigLoader(
  projects: Array<{ type: StorageBackendType; enabled?: boolean }> = [{ type: 'sftp' }],
): ConfigLoaderPort {
  return {
    loadAll: jest.fn(() =>
      projects.map((project) =>
        buildProjectConfig({
          enabled: project.enabled ?? true,
          storage: {
            type: project.type,
            repository: 'repo',
            password: 'pass',
            snapshotMode: 'combined',
            config: {},
          },
        }),
      ),
    ),
    getProject: jest.fn(),
    validate: jest.fn(),
    reload: jest.fn(),
  };
}

function createService(env: Record<string, string>, loader = createConfigLoader()): EnvValidationService {
  return new EnvValidationService(createConfigService(env), loader);
}

describe('EnvValidationService', () => {
  it('throws in production when required vars are missing', () => {
    const service = createService({ NODE_ENV: 'production' });

    expect(() => service.onModuleInit()).toThrow('Missing required environment variables');
  });

  it('does not throw in production when all required vars are set', () => {
    const service = createService({
      NODE_ENV: 'production',
      AUDIT_DB_HOST: 'db.example.com',
      AUDIT_DB_PASSWORD: 'secret',
      HETZNER_SSH_HOST: 'storage.example.com',
      HETZNER_SSH_USER: 'u123456',
      HETZNER_SSH_KEY_PATH: '/ssh-keys/id_ed25519',
    });

    expect(() => service.onModuleInit()).not.toThrow();
  });

  it('does not throw in development even with missing vars', () => {
    const service = createService({ NODE_ENV: 'development' });

    expect(() => service.onModuleInit()).not.toThrow();
  });

  it('skips validation in CLI mode', () => {
    const service = createService({ NODE_ENV: 'production', BACKUPCTL_CLI_MODE: '1' });

    expect(() => service.onModuleInit()).not.toThrow();
  });

  it('includes missing var names in error message', () => {
    const service = createService({ NODE_ENV: 'production', AUDIT_DB_HOST: 'db.example.com' });

    expect(() => service.onModuleInit()).toThrow('AUDIT_DB_PASSWORD');
    expect(() => service.onModuleInit()).toThrow('HETZNER_SSH_HOST');
  });

  describe('backend-conditional SSH vars', () => {
    const productionCore = {
      NODE_ENV: 'production',
      AUDIT_DB_HOST: 'db.example.com',
      AUDIT_DB_PASSWORD: 'secret',
    };

    it('boots an S3-only deployment with no Hetzner SSH vars set', () => {
      const service = createService(productionCore, createConfigLoader([{ type: 's3' }]));

      expect(() => service.onModuleInit()).not.toThrow();
    });

    it('still requires SSH vars when any enabled project uses sftp', () => {
      const service = createService(productionCore, createConfigLoader([{ type: 's3' }, { type: 'sftp' }]));

      expect(() => service.onModuleInit()).toThrow('HETZNER_SSH_HOST');
    });

    it('ignores disabled sftp projects', () => {
      const service = createService(
        productionCore,
        createConfigLoader([{ type: 's3' }, { type: 'sftp', enabled: false }]),
      );

      expect(() => service.onModuleInit()).not.toThrow();
    });

    it('does not fail boot when the project config cannot be read', () => {
      const brokenLoader: ConfigLoaderPort = {
        loadAll: jest.fn(() => {
          throw new Error('projects.yml is malformed');
        }),
        getProject: jest.fn(),
        validate: jest.fn(),
        reload: jest.fn(),
      };

      const service = createService(productionCore, brokenLoader);

      expect(() => service.onModuleInit()).not.toThrow();
    });
  });
});
