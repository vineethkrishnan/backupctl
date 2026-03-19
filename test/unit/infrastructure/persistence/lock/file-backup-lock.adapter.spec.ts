import * as fs from 'fs';

import { ConfigService } from '@nestjs/config';

import { FileBackupLockAdapter } from '@domain/backup/infrastructure/adapters/lock/file-backup-lock.adapter';

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

    // Default: make constants available
    (fs.constants as Record<string, number>).O_CREAT = 0o100;
    (fs.constants as Record<string, number>).O_EXCL = 0o200;
    (fs.constants as Record<string, number>).O_WRONLY = 0o1;

    adapter = new FileBackupLockAdapter(createConfigService());
  });

  describe('acquire', () => {
    it('should create lock file atomically and return true when not locked', async () => {
      mockFs.openSync.mockReturnValue(42);

      const result = await adapter.acquire('myproject');

      expect(result).toBe(true);
      expect(mockFs.mkdirSync).toHaveBeenCalledWith('/data/backups/myproject', {
        recursive: true,
      });
      expect(mockFs.openSync).toHaveBeenCalledWith(
        lockPath,
        fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
      );
      expect(mockFs.writeSync).toHaveBeenCalledWith(42, expect.any(String));
      expect(mockFs.closeSync).toHaveBeenCalledWith(42);
    });

    it('should return false when lock already exists (O_EXCL fails)', async () => {
      mockFs.openSync.mockImplementation(() => {
        const err = new Error('EEXIST: file already exists') as NodeJS.ErrnoException;
        err.code = 'EEXIST';
        throw err;
      });

      const result = await adapter.acquire('myproject');

      expect(result).toBe(false);
      expect(mockFs.writeSync).not.toHaveBeenCalled();
    });

    it('should still acquire lock and close fd when writeSync fails', async () => {
      mockFs.openSync.mockReturnValueOnce(99);
      mockFs.writeSync.mockImplementationOnce(() => {
        throw new Error('disk full');
      });

      const result = await adapter.acquire('myproject');

      expect(result).toBe(true);
      expect(mockFs.closeSync).toHaveBeenCalledWith(99);
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
      mockFs.openSync.mockReturnValue(1);

      await adapter.acquireOrQueue('myproject');

      expect(mockFs.openSync).toHaveBeenCalledTimes(1);
    });

    it('should poll until lock is released then acquire', async () => {
      let callCount = 0;
      mockFs.openSync.mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          const err = new Error('EEXIST') as NodeJS.ErrnoException;
          err.code = 'EEXIST';
          throw err;
        }
        return 1;
      });

      await adapter.acquireOrQueue('myproject');

      expect(callCount).toBe(3);
    }, 10000);
  });
});
