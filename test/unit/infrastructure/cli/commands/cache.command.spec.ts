import { CacheCommand } from '@infrastructure/cli/commands/cache.command';
import { CacheManagementService } from '@application/backup/cache-management.service';
import { CacheInfo } from '@domain/backup/models/cache-info.model';

describe('CacheCommand', () => {
  let command: CacheCommand;
  let cacheManagement: jest.Mocked<CacheManagementService>;

  beforeEach(() => {
    cacheManagement = {
      getCacheInfo: jest.fn(),
      clearCache: jest.fn(),
      clearAllCaches: jest.fn(),
    } as unknown as jest.Mocked<CacheManagementService>;

    command = new CacheCommand(cacheManagement);
    process.exitCode = undefined;
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('should show cache info for a project', async () => {
    cacheManagement.getCacheInfo.mockResolvedValue(
      new CacheInfo('test-project', 1048576, '/cache/test-project'),
    );

    await command.run(['test-project'], {});

    expect(cacheManagement.getCacheInfo).toHaveBeenCalledWith('test-project');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('test-project'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('/cache/test-project'));
  });

  it('should clear cache when --clear is set', async () => {
    cacheManagement.clearCache.mockResolvedValue();

    await command.run(['test-project'], { clear: true });

    expect(cacheManagement.clearCache).toHaveBeenCalledWith('test-project');
    expect(console.log).toHaveBeenCalledWith('Cache cleared for test-project.');
  });

  it('should clear all caches when --clear-all is set', async () => {
    cacheManagement.clearAllCaches.mockResolvedValue();

    await command.run([], { clearAll: true });

    expect(cacheManagement.clearAllCaches).toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith('All project caches cleared.');
  });

  it('should set exit code 1 when project name missing without --clear-all', async () => {
    await command.run([], {});

    expect(process.exitCode).toBe(1);
  });

  it('should set exit code 1 on error', async () => {
    cacheManagement.getCacheInfo.mockRejectedValue(new Error('Cache not found'));

    await command.run(['test-project'], {});

    expect(process.exitCode).toBe(1);
  });
});
