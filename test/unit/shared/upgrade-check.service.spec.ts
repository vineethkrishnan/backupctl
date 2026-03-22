import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import { UpgradeCheckService } from '@common/upgrade/upgrade-check.service';
import { UpgradeInfo } from '@common/upgrade/upgrade-info.model';

jest.mock('fs');

const mockedFs = jest.mocked(fs);

describe('UpgradeCheckService', () => {
  let service: UpgradeCheckService;
  let configService: jest.Mocked<ConfigService>;

  const cacheFilePath = '/data/backups/.upgrade-info';

  const cachedInfo: UpgradeInfo = {
    currentVersion: '0.1.8',
    latestVersion: '0.2.0',
    releaseUrl: 'https://github.com/vineethkrishnan/backupctl/releases/tag/v0.2.0',
    checkedAt: '2026-03-22T10:00:00.000Z',
    upgradeAvailable: true,
  };

  beforeEach(() => {
    configService = {
      get: jest.fn().mockReturnValue('/data/backups'),
    } as unknown as jest.Mocked<ConfigService>;

    service = new UpgradeCheckService(configService);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── getCachedInfo ──────────────────────────────────────

  describe('getCachedInfo', () => {
    it('should return null when cache file does not exist', () => {
      mockedFs.existsSync.mockReturnValue(false);

      expect(service.getCachedInfo()).toBeNull();
      expect(mockedFs.existsSync).toHaveBeenCalledWith(cacheFilePath);
    });

    it('should return parsed info when cache file exists', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(cachedInfo));

      const result = service.getCachedInfo();

      expect(result).toEqual(cachedInfo);
    });

    it('should return null when cache file contains invalid JSON', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('not json');

      expect(service.getCachedInfo()).toBeNull();
    });
  });

  // ── clearCache ─────────────────────────────────────────

  describe('clearCache', () => {
    it('should delete cache file when it exists', () => {
      mockedFs.existsSync.mockReturnValue(true);

      service.clearCache();

      expect(mockedFs.unlinkSync).toHaveBeenCalledWith(cacheFilePath);
    });

    it('should do nothing when cache file does not exist', () => {
      mockedFs.existsSync.mockReturnValue(false);

      service.clearCache();

      expect(mockedFs.unlinkSync).not.toHaveBeenCalled();
    });
  });

  // ── checkForUpdate ─────────────────────────────────────

  describe('checkForUpdate', () => {
    it('should call GitHub API and return upgrade info', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          tag_name: 'v0.2.0',
          html_url: 'https://github.com/vineethkrishnan/backupctl/releases/tag/v0.2.0',
        }),
      };
      jest.spyOn(global, 'fetch').mockResolvedValue(mockResponse as unknown as Response);
      mockedFs.writeFileSync.mockImplementation();

      const result = await service.checkForUpdate();

      expect(result.latestVersion).toBe('0.2.0');
      expect(result.releaseUrl).toContain('v0.2.0');
      expect(result.upgradeAvailable).toBe(true);
      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
        cacheFilePath,
        expect.any(String),
      );
    });

    it('should detect no upgrade when versions match', async () => {
      mockedFs.readFileSync.mockReturnValue(JSON.stringify({ version: '0.1.8' }));
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          tag_name: 'v0.1.8',
          html_url: 'https://github.com/vineethkrishnan/backupctl/releases/tag/v0.1.8',
        }),
      };
      jest.spyOn(global, 'fetch').mockResolvedValue(mockResponse as unknown as Response);
      mockedFs.writeFileSync.mockImplementation();

      const result = await service.checkForUpdate();

      expect(result.upgradeAvailable).toBe(false);
    });

    it('should throw when GitHub API returns non-200', async () => {
      const mockResponse = { ok: false, status: 403 };
      jest.spyOn(global, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

      await expect(service.checkForUpdate()).rejects.toThrow('GitHub API returned 403');
    });

    it('should detect upgrade when major version is higher', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          tag_name: 'v2.0.0',
          html_url: 'https://github.com/vineethkrishnan/backupctl/releases/tag/v2.0.0',
        }),
      };
      jest.spyOn(global, 'fetch').mockResolvedValue(mockResponse as unknown as Response);
      mockedFs.writeFileSync.mockImplementation();

      const result = await service.checkForUpdate();

      expect(result.upgradeAvailable).toBe(true);
    });

    it('should not detect upgrade when major version is lower', async () => {
      mockedFs.readFileSync.mockReturnValue(JSON.stringify({ version: '2.0.0' }));
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          tag_name: 'v1.0.0',
          html_url: 'https://github.com/vineethkrishnan/backupctl/releases/tag/v1.0.0',
        }),
      };
      jest.spyOn(global, 'fetch').mockResolvedValue(mockResponse as unknown as Response);
      mockedFs.writeFileSync.mockImplementation();

      const result = await service.checkForUpdate();

      expect(result.upgradeAvailable).toBe(false);
    });

    it('should detect upgrade when minor version is higher', async () => {
      mockedFs.readFileSync.mockReturnValue(JSON.stringify({ version: '1.1.0' }));
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          tag_name: 'v1.3.0',
          html_url: 'https://github.com/vineethkrishnan/backupctl/releases/tag/v1.3.0',
        }),
      };
      jest.spyOn(global, 'fetch').mockResolvedValue(mockResponse as unknown as Response);
      mockedFs.writeFileSync.mockImplementation();

      const result = await service.checkForUpdate();

      expect(result.upgradeAvailable).toBe(true);
    });

    it('should not detect upgrade when minor version is lower', async () => {
      mockedFs.readFileSync.mockReturnValue(JSON.stringify({ version: '1.3.0' }));
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          tag_name: 'v1.1.0',
          html_url: 'https://github.com/vineethkrishnan/backupctl/releases/tag/v1.1.0',
        }),
      };
      jest.spyOn(global, 'fetch').mockResolvedValue(mockResponse as unknown as Response);
      mockedFs.writeFileSync.mockImplementation();

      const result = await service.checkForUpdate();

      expect(result.upgradeAvailable).toBe(false);
    });

    it('should not cache when writeFileSync fails', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          tag_name: 'v0.2.0',
          html_url: 'https://github.com/vineethkrishnan/backupctl/releases/tag/v0.2.0',
        }),
      };
      jest.spyOn(global, 'fetch').mockResolvedValue(mockResponse as unknown as Response);
      mockedFs.writeFileSync.mockImplementation(() => {
        throw new Error('EACCES');
      });

      const result = await service.checkForUpdate();

      expect(result.latestVersion).toBe('0.2.0');
    });
  });

  // ── printUpgradeNotice ─────────────────────────────────

  describe('printUpgradeNotice', () => {
    let originalNodeEnv: string | undefined;
    let originalNoUpdateCheck: string | undefined;
    let stderrSpy: jest.SpyInstance;

    beforeEach(() => {
      originalNodeEnv = process.env.NODE_ENV;
      originalNoUpdateCheck = process.env.BACKUPCTL_NO_UPDATE_CHECK;
      stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation();
    });

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
      process.env.BACKUPCTL_NO_UPDATE_CHECK = originalNoUpdateCheck;
      stderrSpy.mockRestore();
    });

    it('should skip when NODE_ENV is development', async () => {
      process.env.NODE_ENV = 'development';

      await service.printUpgradeNotice();

      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('should skip when BACKUPCTL_NO_UPDATE_CHECK is set', async () => {
      process.env.NODE_ENV = 'production';
      process.env.BACKUPCTL_NO_UPDATE_CHECK = '1';

      await service.printUpgradeNotice();

      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('should skip when stderr is not a TTY', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.BACKUPCTL_NO_UPDATE_CHECK;
      Object.defineProperty(process.stderr, 'isTTY', { value: false, configurable: true });

      await service.printUpgradeNotice();

      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('should print notice when upgrade is available and TTY', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.BACKUPCTL_NO_UPDATE_CHECK;
      Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true });

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(cachedInfo));

      await service.printUpgradeNotice();

      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('Update available'),
      );
    });

    it('should not print notice when up to date', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.BACKUPCTL_NO_UPDATE_CHECK;
      Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true });

      const upToDate: UpgradeInfo = { ...cachedInfo, upgradeAvailable: false };
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(upToDate));

      await service.printUpgradeNotice();

      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('should silently swallow errors', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.BACKUPCTL_NO_UPDATE_CHECK;
      Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true });

      mockedFs.existsSync.mockReturnValue(false);
      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));
      mockedFs.writeFileSync.mockImplementation();

      await expect(service.printUpgradeNotice()).resolves.not.toThrow();
    });
  });
});
