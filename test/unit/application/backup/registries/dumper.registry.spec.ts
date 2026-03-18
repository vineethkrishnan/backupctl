import { DatabaseDumperPort } from '@domain/backup/ports/database-dumper.port';
import { DumperRegistry } from '@application/backup/registries/dumper.registry';

describe('DumperRegistry', () => {
  let registry: DumperRegistry;
  let mockDumper: DatabaseDumperPort;

  beforeEach(() => {
    registry = new DumperRegistry();
    mockDumper = {
      dump: jest.fn(),
      verify: jest.fn(),
    } as unknown as DatabaseDumperPort;
  });

  it('registers and resolves a dumper by type', () => {
    registry.register('postgres', mockDumper);

    const resolved = registry.resolve('postgres');

    expect(resolved).toBe(mockDumper);
  });

  it('resolve is case-insensitive (register postgres, resolve POSTGRES)', () => {
    registry.register('postgres', mockDumper);

    const resolved = registry.resolve('POSTGRES');

    expect(resolved).toBe(mockDumper);
  });

  it('resolve unknown type throws with descriptive message', () => {
    expect(() => registry.resolve('unknown')).toThrow(
      'No database dumper registered for type: unknown',
    );
  });

  it('getRegisteredTypes returns all registered types', () => {
    registry.register('postgres', mockDumper);
    registry.register('mysql', mockDumper);
    registry.register('mongo', mockDumper);

    const types = registry.getRegisteredTypes();

    expect(types).toEqual(['postgres', 'mysql', 'mongo']);
  });

  it('registering same type overwrites previous dumper', () => {
    const firstDumper: DatabaseDumperPort = {
      dump: jest.fn(),
      verify: jest.fn(),
    };
    const secondDumper: DatabaseDumperPort = {
      dump: jest.fn(),
      verify: jest.fn(),
    };

    registry.register('postgres', firstDumper);
    registry.register('postgres', secondDumper);

    const resolved = registry.resolve('postgres');

    expect(resolved).toBe(secondDumper);
  });
});
