import { RemoteStoragePort } from '@domain/backup/application/ports/remote-storage.port';

export function createMockRemoteStorage(
  overrides: Partial<jest.Mocked<RemoteStoragePort>> = {},
): jest.Mocked<RemoteStoragePort> {
  return {
    sync: jest.fn(),
    prune: jest.fn(),
    listSnapshots: jest.fn(),
    restore: jest.fn(),
    exec: jest.fn(),
    getCacheInfo: jest.fn(),
    clearCache: jest.fn(),
    unlock: jest.fn(),
    checkConnectivity: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
