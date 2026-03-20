import { ConfigService } from '@nestjs/config';
import { EnvValidationService } from '@common/validation/env-validation.service';

function createConfigService(env: Record<string, string>): ConfigService {
  return {
    get: jest.fn((key: string) => env[key] ?? undefined),
  } as unknown as ConfigService;
}

describe('EnvValidationService', () => {
  it('throws in production when required vars are missing', () => {
    const service = new EnvValidationService(
      createConfigService({ NODE_ENV: 'production' }),
    );

    expect(() => service.onModuleInit()).toThrow('Missing required environment variables');
  });

  it('does not throw in production when all required vars are set', () => {
    const service = new EnvValidationService(
      createConfigService({
        NODE_ENV: 'production',
        AUDIT_DB_HOST: 'db.example.com',
        AUDIT_DB_PASSWORD: 'secret',
        HETZNER_SSH_HOST: 'storage.example.com',
        HETZNER_SSH_USER: 'u123456',
        HETZNER_SSH_KEY_PATH: '/ssh-keys/id_ed25519',
      }),
    );

    expect(() => service.onModuleInit()).not.toThrow();
  });

  it('does not throw in development even with missing vars', () => {
    const service = new EnvValidationService(
      createConfigService({ NODE_ENV: 'development' }),
    );

    expect(() => service.onModuleInit()).not.toThrow();
  });

  it('skips validation in CLI mode', () => {
    const service = new EnvValidationService(
      createConfigService({
        NODE_ENV: 'production',
        BACKUPCTL_CLI_MODE: '1',
      }),
    );

    expect(() => service.onModuleInit()).not.toThrow();
  });

  it('includes missing var names in error message', () => {
    const service = new EnvValidationService(
      createConfigService({
        NODE_ENV: 'production',
        AUDIT_DB_HOST: 'db.example.com',
      }),
    );

    expect(() => service.onModuleInit()).toThrow('AUDIT_DB_PASSWORD');
    expect(() => service.onModuleInit()).toThrow('HETZNER_SSH_HOST');
  });
});
