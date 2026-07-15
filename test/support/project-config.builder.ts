import { ProjectConfig, ProjectConfigParams } from '@domain/config/domain/project-config.model';
import { RetentionPolicy } from '@domain/config/domain/retention-policy.model';

export function buildProjectConfigParams(
  overrides: Partial<ProjectConfigParams> = {},
): ProjectConfigParams {
  return {
    name: 'test-project',
    enabled: true,
    cron: '0 2 * * *',
    timeoutMinutes: null,
    dockerNetwork: null,
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

export function buildProjectConfig(overrides: Partial<ProjectConfigParams> = {}): ProjectConfig {
  return new ProjectConfig(buildProjectConfigParams(overrides));
}
