import { DumperBootstrapService } from '@domain/backup/infrastructure/adapters/dumpers/dumper-bootstrap.service';
import { DumperRegistry } from '@domain/backup/application/registries/dumper.registry';
import { ProjectConfig } from '@domain/config/domain/project-config.model';
import { RetentionPolicy } from '@domain/config/domain/retention-policy.model';

describe('DumperBootstrapService', () => {
  let registry: DumperRegistry;
  let service: DumperBootstrapService;

  beforeEach(() => {
    registry = new DumperRegistry();
    service = new DumperBootstrapService(registry);
  });

  function buildConfig(dbType: string): ProjectConfig {
    return new ProjectConfig({
      name: 'test',
      enabled: true,
      cron: '0 2 * * *',
      timeoutMinutes: null,
      database: { type: dbType, host: 'db', port: 5432, name: 'testdb', user: 'admin', password: 'secret' },
      compression: { enabled: true },
      assets: { paths: [] },
      restic: { repositoryPath: '/repo', password: 'pass', snapshotMode: 'combined' },
      retention: new RetentionPolicy(7, 7, 4, 3),
      encryption: null,
      hooks: null,
      verification: { enabled: false },
      notification: null,
    });
  }

  it('registers postgres, mysql, and mongodb dumpers on init', () => {
    service.onModuleInit();

    expect(registry.has('postgres')).toBe(true);
    expect(registry.has('mysql')).toBe(true);
    expect(registry.has('mongodb')).toBe(true);
  });

  it('creates a postgres dumper from project config', () => {
    service.onModuleInit();

    const dumper = registry.create('postgres', buildConfig('postgres'));

    expect(dumper).toBeDefined();
    expect(typeof dumper.dump).toBe('function');
    expect(typeof dumper.verify).toBe('function');
  });

  it('creates a mysql dumper from project config', () => {
    service.onModuleInit();

    const dumper = registry.create('mysql', buildConfig('mysql'));

    expect(dumper).toBeDefined();
    expect(typeof dumper.dump).toBe('function');
  });

  it('creates a mongodb dumper from project config', () => {
    service.onModuleInit();

    const dumper = registry.create('mongodb', buildConfig('mongodb'));

    expect(dumper).toBeDefined();
    expect(typeof dumper.dump).toBe('function');
  });

  it('getRegisteredTypes returns all three types', () => {
    service.onModuleInit();

    expect(registry.getRegisteredTypes()).toEqual(['postgres', 'mysql', 'mongodb']);
  });
});
