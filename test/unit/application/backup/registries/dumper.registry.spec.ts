import { DatabaseDumperPort } from '@domain/backup/application/ports/database-dumper.port';
import { DumperRegistry, DumperFactory } from '@domain/backup/application/registries/dumper.registry';
import { ProjectConfig } from '@domain/config/domain/project-config.model';
import { RetentionPolicy } from '@domain/config/domain/retention-policy.model';

function buildConfig(): ProjectConfig {
  return new ProjectConfig({
    name: 'test',
    enabled: true,
    cron: '0 2 * * *',
    timeoutMinutes: null,
    database: { type: 'postgres', host: 'localhost', port: 5432, name: 'testdb', user: 'u', password: 'p' },
    compression: { enabled: true },
    assets: { paths: [] },
    restic: { repositoryPath: '/repo', password: 'pass', snapshotMode: 'combined' },
    retention: new RetentionPolicy(7, 7, 4, 3),
    encryption: null,
    hooks: null,
    verification: { enabled: false },
    notification: null,
    monitor: null,
  });
}

function createMockDumper(): DatabaseDumperPort {
  return { dump: jest.fn(), verify: jest.fn() };
}

describe('DumperRegistry', () => {
  let registry: DumperRegistry;
  let mockDumper: DatabaseDumperPort;
  let mockFactory: DumperFactory;

  beforeEach(() => {
    registry = new DumperRegistry();
    mockDumper = createMockDumper();
    mockFactory = jest.fn().mockReturnValue(mockDumper);
  });

  it('registers a factory and creates a dumper by type', () => {
    registry.register('postgres', mockFactory);

    const created = registry.create('postgres', buildConfig());

    expect(created).toBe(mockDumper);
    expect(mockFactory).toHaveBeenCalledWith(buildConfig());
  });

  it('create is case-insensitive (register postgres, create POSTGRES)', () => {
    registry.register('postgres', mockFactory);

    const created = registry.create('POSTGRES', buildConfig());

    expect(created).toBe(mockDumper);
  });

  it('create unknown type throws with descriptive message', () => {
    expect(() => registry.create('unknown', buildConfig())).toThrow(
      'No database dumper registered for type: unknown',
    );
  });

  it('has returns true for registered types', () => {
    registry.register('postgres', mockFactory);

    expect(registry.has('postgres')).toBe(true);
    expect(registry.has('POSTGRES')).toBe(true);
    expect(registry.has('mysql')).toBe(false);
  });

  it('getRegisteredTypes returns all registered types', () => {
    registry.register('postgres', mockFactory);
    registry.register('mysql', mockFactory);
    registry.register('mongo', mockFactory);

    const types = registry.getRegisteredTypes();

    expect(types).toEqual(['postgres', 'mysql', 'mongo']);
  });

  it('registering same type overwrites previous factory', () => {
    const firstDumper = createMockDumper();
    const secondDumper = createMockDumper();
    const firstFactory: DumperFactory = jest.fn().mockReturnValue(firstDumper);
    const secondFactory: DumperFactory = jest.fn().mockReturnValue(secondDumper);

    registry.register('postgres', firstFactory);
    registry.register('postgres', secondFactory);

    const created = registry.create('postgres', buildConfig());

    expect(created).toBe(secondDumper);
  });

  it('factory receives the project config', () => {
    const factory = jest.fn().mockReturnValue(mockDumper);
    registry.register('postgres', factory);
    const config = buildConfig();

    registry.create('postgres', config);

    expect(factory).toHaveBeenCalledWith(config);
  });
});
