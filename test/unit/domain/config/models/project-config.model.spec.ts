import { ProjectConfig, ProjectConfigParams } from '@domain/config/domain/project-config.model';
import { RetentionPolicy } from '@domain/config/domain/retention-policy.model';

function buildParams(overrides: Partial<ProjectConfigParams> = {}): ProjectConfigParams {
  return {
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
    },
    compression: { enabled: true },
    assets: { paths: [] },
    restic: {
      repositoryPath: '/repo/test',
      password: 'restic-pass',
      snapshotMode: 'combined',
    },
    retention: new RetentionPolicy(7, 14, 4),
    encryption: null,
    hooks: null,
    verification: { enabled: false },
    notification: null,
    monitor: null,
    ...overrides,
  };
}

describe('ProjectConfig', () => {
  describe('hasDatabase', () => {
    it('should return true when database is configured', () => {
      const config = new ProjectConfig(buildParams());

      expect(config.hasDatabase()).toBe(true);
    });

    it('should return false when database is null', () => {
      const config = new ProjectConfig(buildParams({ database: null }));

      expect(config.hasDatabase()).toBe(false);
    });
  });

  describe('hasEncryption', () => {
    it('should return true when encryption is enabled', () => {
      const config = new ProjectConfig(
        buildParams({ encryption: { enabled: true, type: 'gpg', recipient: 'admin@test.com' } }),
      );

      expect(config.hasEncryption()).toBe(true);
    });

    it('should return false when encryption is null', () => {
      const config = new ProjectConfig(buildParams({ encryption: null }));

      expect(config.hasEncryption()).toBe(false);
    });

    it('should return false when encryption is disabled', () => {
      const config = new ProjectConfig(
        buildParams({ encryption: { enabled: false, type: 'gpg', recipient: 'admin@test.com' } }),
      );

      expect(config.hasEncryption()).toBe(false);
    });
  });

  describe('hasHooks', () => {
    it('should return true when preBackup is configured', () => {
      const config = new ProjectConfig(
        buildParams({ hooks: { preBackup: '/scripts/pre.sh', postBackup: null } }),
      );

      expect(config.hasHooks()).toBe(true);
    });

    it('should return true when postBackup is configured', () => {
      const config = new ProjectConfig(
        buildParams({ hooks: { preBackup: null, postBackup: '/scripts/post.sh' } }),
      );

      expect(config.hasHooks()).toBe(true);
    });

    it('should return false when hooks is null', () => {
      const config = new ProjectConfig(buildParams({ hooks: null }));

      expect(config.hasHooks()).toBe(false);
    });
  });

  describe('hasVerification', () => {
    it('should return true when verification is enabled', () => {
      const config = new ProjectConfig(buildParams({ verification: { enabled: true } }));

      expect(config.hasVerification()).toBe(true);
    });

    it('should return false when verification is disabled', () => {
      const config = new ProjectConfig(buildParams({ verification: { enabled: false } }));

      expect(config.hasVerification()).toBe(false);
    });
  });

  describe('hasAssets', () => {
    it('should return true when paths are configured', () => {
      const config = new ProjectConfig(
        buildParams({ assets: { paths: ['/var/uploads', '/var/media'] } }),
      );

      expect(config.hasAssets()).toBe(true);
    });

    it('should return false when paths are empty', () => {
      const config = new ProjectConfig(buildParams({ assets: { paths: [] } }));

      expect(config.hasAssets()).toBe(false);
    });
  });

  describe('hasTimeout', () => {
    it('should return true when timeoutMinutes is configured', () => {
      const config = new ProjectConfig(buildParams({ timeoutMinutes: 30 }));

      expect(config.hasTimeout()).toBe(true);
    });

    it('should return false when timeoutMinutes is null', () => {
      const config = new ProjectConfig(buildParams({ timeoutMinutes: null }));

      expect(config.hasTimeout()).toBe(false);
    });

    it('should return false when timeoutMinutes is 0', () => {
      const config = new ProjectConfig(buildParams({ timeoutMinutes: 0 }));

      expect(config.hasTimeout()).toBe(false);
    });
  });

  describe('hasMonitor', () => {
    it('should return true when monitor is configured', () => {
      const config = new ProjectConfig(buildParams({
        monitor: { type: 'uptime-kuma', config: { push_token: 'abc123' } },
      }));

      expect(config.hasMonitor()).toBe(true);
    });

    it('should return false when monitor is null', () => {
      const config = new ProjectConfig(buildParams({ monitor: null }));

      expect(config.hasMonitor()).toBe(false);
    });
  });
});
