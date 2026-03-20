import { FileCleanupAdapter } from '@domain/backup/infrastructure/adapters/cleanup/file-cleanup.adapter';
import { CleanupResult } from '@domain/backup/domain/value-objects/cleanup-result.model';

const mockAccess = jest.fn();
const mockReaddir = jest.fn();
const mockStat = jest.fn();
const mockUnlink = jest.fn();

jest.mock('fs', () => ({
  promises: {
    access: (...args: unknown[]) => mockAccess(...args),
    readdir: (...args: unknown[]) => mockReaddir(...args),
    stat: (...args: unknown[]) => mockStat(...args),
    unlink: (...args: unknown[]) => mockUnlink(...args),
  },
}));

describe('FileCleanupAdapter', () => {
  let adapter: FileCleanupAdapter;
  const directory = '/data/backups/myproject';
  const retentionDays = 7;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new FileCleanupAdapter();
  });

  it('should return empty result when directory does not exist', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'));

    const result = await adapter.cleanup(directory, retentionDays);

    expect(result).toEqual(new CleanupResult(0, 0));
    expect(mockReaddir).not.toHaveBeenCalled();
  });

  it('should remove files older than retention period', async () => {
    const now = Date.now();
    const eightDaysAgo = now - 8 * 24 * 60 * 60 * 1000;
    const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000;

    mockAccess.mockResolvedValue(undefined);
    mockReaddir.mockResolvedValue([
      { name: 'old-dump.sql.gz', isFile: () => true },
      { name: 'recent-dump.sql.gz', isFile: () => true },
    ]);
    mockStat.mockImplementation((filePath: string) => {
      if (filePath.includes('old-dump')) {
        return Promise.resolve({ mtimeMs: eightDaysAgo, size: 1024 });
      }
      return Promise.resolve({ mtimeMs: twoDaysAgo, size: 2048 });
    });
    mockUnlink.mockResolvedValue(undefined);

    const result = await adapter.cleanup(directory, retentionDays);

    expect(result.filesRemoved).toBe(1);
    expect(result.spaceFreed).toBe(1024);
    expect(mockUnlink).toHaveBeenCalledTimes(1);
    expect(mockUnlink).toHaveBeenCalledWith(`${directory}/old-dump.sql.gz`);
  });

  it('should keep files newer than retention period', async () => {
    const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;

    mockAccess.mockResolvedValue(undefined);
    mockReaddir.mockResolvedValue([
      { name: 'recent.sql.gz', isFile: () => true },
    ]);
    mockStat.mockResolvedValue({ mtimeMs: twoDaysAgo, size: 4096 });

    const result = await adapter.cleanup(directory, retentionDays);

    expect(result.filesRemoved).toBe(0);
    expect(result.spaceFreed).toBe(0);
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it('should skip directories', async () => {
    const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000;

    mockAccess.mockResolvedValue(undefined);
    mockReaddir.mockResolvedValue([
      { name: 'subdir', isFile: () => false },
    ]);
    mockStat.mockResolvedValue({ mtimeMs: tenDaysAgo, size: 4096 });

    const result = await adapter.cleanup(directory, retentionDays);

    expect(result.filesRemoved).toBe(0);
    expect(result.spaceFreed).toBe(0);
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it('should return correct CleanupResult with count and freed space', async () => {
    const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000;

    mockAccess.mockResolvedValue(undefined);
    mockReaddir.mockResolvedValue([
      { name: 'a.sql.gz', isFile: () => true },
      { name: 'b.sql.gz', isFile: () => true },
    ]);
    mockStat.mockResolvedValue({ mtimeMs: tenDaysAgo, size: 500 });
    mockUnlink.mockResolvedValue(undefined);

    const result = await adapter.cleanup(directory, retentionDays);

    expect(result).toBeInstanceOf(CleanupResult);
    expect(result.filesRemoved).toBe(2);
    expect(result.spaceFreed).toBe(1000);
  });
});
