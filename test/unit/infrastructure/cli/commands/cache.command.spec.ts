import { CacheCommand } from '@domain/backup/presenters/cli/cache.command';
import { GetCacheInfoUseCase } from '@domain/backup/application/use-cases/get-cache-info/get-cache-info.use-case';
import { ClearCacheUseCase } from '@domain/backup/application/use-cases/clear-cache/clear-cache.use-case';
import { CacheInfo } from '@domain/backup/domain/value-objects/cache-info.model';

describe('CacheCommand', () => {
  let command: CacheCommand;
  let getCacheInfo: jest.Mocked<GetCacheInfoUseCase>;
  let clearCache: jest.Mocked<ClearCacheUseCase>;

  beforeEach(() => {
    getCacheInfo = { execute: jest.fn() } as unknown as jest.Mocked<GetCacheInfoUseCase>;
    clearCache = { execute: jest.fn() } as unknown as jest.Mocked<ClearCacheUseCase>;

    command = new CacheCommand(getCacheInfo, clearCache);
    process.exitCode = undefined;
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('should show cache info for a project', async () => {
    getCacheInfo.execute.mockResolvedValue(
      new CacheInfo('test-project', 1048576, '/cache/test-project'),
    );

    await command.run(['test-project'], {});

    expect(getCacheInfo.execute).toHaveBeenCalledWith(
      expect.objectContaining({ projectName: 'test-project' }),
    );
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('test-project'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('/cache/test-project'));
  });

  it('should clear cache when --clear is set', async () => {
    clearCache.execute.mockResolvedValue();

    await command.run(['test-project'], { clear: true });

    expect(clearCache.execute).toHaveBeenCalledWith(
      expect.objectContaining({ projectName: 'test-project' }),
    );
    expect(console.log).toHaveBeenCalledWith('Cache cleared for test-project.');
  });

  it('should clear all caches when --clear-all is set', async () => {
    clearCache.execute.mockResolvedValue();

    await command.run([], { clearAll: true });

    expect(clearCache.execute).toHaveBeenCalledWith(
      expect.objectContaining({ clearAll: true }),
    );
    expect(console.log).toHaveBeenCalledWith('All project caches cleared.');
  });

  it('should set exit code 1 when project name missing without --clear-all', async () => {
    await command.run([], {});

    expect(process.exitCode).toBe(1);
  });

  it('should set exit code 1 on error', async () => {
    getCacheInfo.execute.mockRejectedValue(new Error('Cache not found'));

    await command.run(['test-project'], {});

    expect(process.exitCode).toBe(1);
  });
});
