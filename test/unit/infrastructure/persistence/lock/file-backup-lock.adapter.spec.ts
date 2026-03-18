import * as fs from 'fs';

import { ConfigService } from '@nestjs/config';

import { FileBackupLockAdapter } from '@infrastructure/persistence/lock/file-backup-lock.adapter';

jest.mock('fs');

const mockFs = fs as jest.Mocked<typeof fs>;

function createConfigService(baseDir = '/data/backups'): ConfigService {
  return {
    get: jest.fn((key: string, defaultValue?: string) => {
      if (key === 'BACKUP_BASE_DIR') return baseDir;
      return defaultValue;
    }),
  } as unknown as ConfigService;
}

describe('FileBackupLockAdapter', () => {
  let adapter: FileBackupLockAdapter;
  const lockPath = '/data/backups/myproject/.lock';

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new FileBackupLockAdapter(createConfigService());
  });

  describe('acquire', () => {
    it('should create lock file and return true when not locked', async () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = await adapter.acquire('myproject');

      expect(result).toBe(true);
      expect(mockFs.mkdirSync).toHaveBeenCalledWith('/data/backups/myproject', {
        recursive: true,
      });
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        lockPath,
        expect.any(String),
        'utf-8',
      );
    });

    it('should return false when lock already exists', async () => {
      mockFs.existsSync.mockReturnValue(true);

      const result = await adapter.acquire('myproject');

      expect(result).toBe(false);
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe('release', () => {
    it('should delete lock file', async () => {
      await adapter.release('myproject');

      expect(mockFs.unlinkSync).toHaveBeenCalledWith(lockPath);
    });

    it('should not throw when lock file does not exist', async () => {
      mockFs.unlinkSync.mockImplementation(() => {
        throw new Error('ENOENT: no such file');
      });

      await expect(adapter.release('myproject')).resolves.not.toThrow();
    });
  });

  describe('isLocked', () => {
    it('should return true when lock file exists', () => {
      mockFs.existsSync.mockReturnValue(true);

      expect(adapter.isLocked('myproject')).toBe(true);
      expect(mockFs.existsSync).toHaveBeenCalledWith(lockPath);
    });

    it('should return false when lock file does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      expect(adapter.isLocked('myproject')).toBe(false);
    });
  });

  describe('acquireOrQueue', () => {
    it('should acquire immediately when not locked', async () => {
      mockFs.existsSync.mockReturnValue(false);

      await adapter.acquireOrQueue('myproject');

      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1);
    });

    it('should poll until lock is released then acquire', async () => {
      let callCount = 0;
      mockFs.existsSync.mockImplementation(() => {
        callCount++;
        // First two calls: locked. Third call: unlocked.
        return callCount <= 2;
      });

      await adapter.acquireOrQueue('myproject');

      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1);
      expect(callCount).toBe(3);
    }, 10000);
  });
});
