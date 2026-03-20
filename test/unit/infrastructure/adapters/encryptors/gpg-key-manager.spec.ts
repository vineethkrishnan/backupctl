import { ConfigService } from '@nestjs/config';
import { GpgKeyManagerAdapter as GpgKeyManager } from '@domain/backup/infrastructure/adapters/encryptors/gpg-key-manager.adapter';

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
}));

jest.mock('@common/helpers/child-process.util', () => ({
  safeExecFile: jest.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}));

import * as fs from 'fs';
import { safeExecFile } from '@common/helpers/child-process.util';

const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockReaddirSync = fs.readdirSync as jest.MockedFunction<typeof fs.readdirSync>;
const mockSafeExecFile = safeExecFile as jest.MockedFunction<typeof safeExecFile>;

describe('GpgKeyManager', () => {
  let manager: GpgKeyManager;

  beforeEach(() => {
    jest.clearAllMocks();
    const configService = { get: jest.fn().mockReturnValue('/gpg-keys') } as unknown as ConfigService;
    manager = new GpgKeyManager(configService);
  });

  describe('importKey', () => {
    it('calls gpg --batch --import with file path', async () => {
      await manager.importKey('/gpg-keys/backup.pub');

      expect(mockSafeExecFile).toHaveBeenCalledWith('gpg', ['--batch', '--import', '/gpg-keys/backup.pub']);
    });

    it('propagates gpg import errors', async () => {
      mockSafeExecFile.mockRejectedValueOnce(new Error('gpg import failed'));

      await expect(manager.importKey('/bad/key')).rejects.toThrow('gpg import failed');
    });
  });

  describe('importAllFromDirectory', () => {
    it('returns empty array when directory does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      const result = await manager.importAllFromDirectory();

      expect(result).toEqual([]);
    });

    it('imports .gpg and .pub files from directory', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['key1.pub', 'key2.gpg', 'readme.txt'] as unknown as ReturnType<typeof fs.readdirSync>);

      const result = await manager.importAllFromDirectory();

      expect(result).toEqual(['/gpg-keys/key1.pub', '/gpg-keys/key2.gpg']);
      expect(mockSafeExecFile).toHaveBeenCalledTimes(2);
    });

    it('skips non-key files', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['readme.md', 'data.json'] as unknown as ReturnType<typeof fs.readdirSync>);

      const result = await manager.importAllFromDirectory();

      expect(result).toEqual([]);
      expect(mockSafeExecFile).not.toHaveBeenCalled();
    });
  });

  describe('listKeys', () => {
    it('returns gpg key listing output', async () => {
      mockSafeExecFile.mockResolvedValueOnce({ stdout: 'pub   rsa4096 2024-01-01 [SC]\n', stderr: '' });

      const result = await manager.listKeys();

      expect(result).toContain('rsa4096');
      expect(mockSafeExecFile).toHaveBeenCalledWith('gpg', ['--list-keys', '--keyid-format', 'long']);
    });
  });

  describe('onModuleInit', () => {
    it('auto-imports keys from configured directory', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['backup.pub'] as unknown as ReturnType<typeof fs.readdirSync>);

      await manager.onModuleInit();

      expect(mockSafeExecFile).toHaveBeenCalledWith('gpg', ['--batch', '--import', '/gpg-keys/backup.pub']);
    });

    it('does not throw when import fails (logs warning)', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation(() => { throw new Error('read dir failed'); });

      await expect(manager.onModuleInit()).resolves.not.toThrow();
    });
  });
});
