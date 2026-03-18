import * as fs from 'fs';

import { FileCleanupAdapter } from '@infrastructure/adapters/cleanup/file-cleanup.adapter';
import { CleanupResult } from '@domain/backup/models/cleanup-result.model';

jest.mock('fs');

const mockFs = jest.mocked(fs);

describe('FileCleanupAdapter', () => {
  let adapter: FileCleanupAdapter;
  const directory = '/data/backups/myproject';
  const retentionDays = 7;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new FileCleanupAdapter();
  });

  it('should return empty result when directory does not exist', async () => {
    mockFs.existsSync.mockReturnValue(false);

    const result = await adapter.cleanup(directory, retentionDays);

    expect(result).toEqual(new CleanupResult(0, 0));
    expect(mockFs.readdirSync).not.toHaveBeenCalled();
  });

  it('should remove files older than retention period', async () => {
    const now = Date.now();
    const eightDaysAgo = now - 8 * 24 * 60 * 60 * 1000;
    const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000;

    mockFs.existsSync.mockReturnValue(true);
    (mockFs.readdirSync as jest.Mock).mockReturnValue(['old-dump.sql.gz', 'recent-dump.sql.gz']);
    mockFs.statSync.mockImplementation((filePath: fs.PathLike) => {
      const name = String(filePath);
      if (name.includes('old-dump')) {
        return { isFile: () => true, mtimeMs: eightDaysAgo, size: 1024 } as fs.Stats;
      }
      return { isFile: () => true, mtimeMs: twoDaysAgo, size: 2048 } as fs.Stats;
    });

    const result = await adapter.cleanup(directory, retentionDays);

    expect(result.filesRemoved).toBe(1);
    expect(result.spaceFreed).toBe(1024);
    expect(mockFs.unlinkSync).toHaveBeenCalledTimes(1);
    expect(mockFs.unlinkSync).toHaveBeenCalledWith(`${directory}/old-dump.sql.gz`);
  });

  it('should keep files newer than retention period', async () => {
    const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;

    mockFs.existsSync.mockReturnValue(true);
    (mockFs.readdirSync as jest.Mock).mockReturnValue(['recent.sql.gz']);
    mockFs.statSync.mockReturnValue({
      isFile: () => true,
      mtimeMs: twoDaysAgo,
      size: 4096,
    } as fs.Stats);

    const result = await adapter.cleanup(directory, retentionDays);

    expect(result.filesRemoved).toBe(0);
    expect(result.spaceFreed).toBe(0);
    expect(mockFs.unlinkSync).not.toHaveBeenCalled();
  });

  it('should skip directories', async () => {
    const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000;

    mockFs.existsSync.mockReturnValue(true);
    (mockFs.readdirSync as jest.Mock).mockReturnValue(['subdir']);
    mockFs.statSync.mockReturnValue({
      isFile: () => false,
      mtimeMs: tenDaysAgo,
      size: 4096,
    } as fs.Stats);

    const result = await adapter.cleanup(directory, retentionDays);

    expect(result.filesRemoved).toBe(0);
    expect(result.spaceFreed).toBe(0);
    expect(mockFs.unlinkSync).not.toHaveBeenCalled();
  });

  it('should return correct CleanupResult with count and freed space', async () => {
    const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000;

    mockFs.existsSync.mockReturnValue(true);
    (mockFs.readdirSync as jest.Mock).mockReturnValue(['a.sql.gz', 'b.sql.gz']);
    mockFs.statSync.mockReturnValue({
      isFile: () => true,
      mtimeMs: tenDaysAgo,
      size: 500,
    } as fs.Stats);

    const result = await adapter.cleanup(directory, retentionDays);

    expect(result).toBeInstanceOf(CleanupResult);
    expect(result.filesRemoved).toBe(2);
    expect(result.spaceFreed).toBe(1000);
  });
});
