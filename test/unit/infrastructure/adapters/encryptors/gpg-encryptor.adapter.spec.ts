import { GpgEncryptorAdapter } from '@domain/backup/infrastructure/adapters/encryptors/gpg-encryptor.adapter';

jest.mock('@common/helpers/child-process.util', () => ({
  safeExecFile: jest.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}));

import { safeExecFile } from '@common/helpers/child-process.util';

const mockSafeExecFile = safeExecFile as jest.MockedFunction<typeof safeExecFile>;

describe('GpgEncryptorAdapter', () => {
  const recipient = 'backup@example.com';
  let adapter: GpgEncryptorAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new GpgEncryptorAdapter(recipient);
  });

  describe('encrypt', () => {
    it('should run gpg with correct arguments and return .gpg path', async () => {
      const filePath = '/data/backups/myproject/dump_20260318.sql.gz';

      const result = await adapter.encrypt(filePath);

      expect(mockSafeExecFile).toHaveBeenCalledWith('gpg', [
        '--batch',
        '--yes',
        '--encrypt',
        '--recipient',
        recipient,
        '--output',
        `${filePath}.gpg`,
        filePath,
      ]);
      expect(result).toBe(`${filePath}.gpg`);
    });

    it('should propagate errors from safeExecFile', async () => {
      mockSafeExecFile.mockRejectedValueOnce(new Error('GPG encrypt failed'));

      await expect(adapter.encrypt('/some/file.sql.gz')).rejects.toThrow(
        'GPG encrypt failed',
      );
    });
  });

  describe('decrypt', () => {
    it('should run gpg with correct arguments and return decrypted path', async () => {
      const filePath = '/data/backups/myproject/dump_20260318.sql.gz.gpg';
      const expectedDecryptedPath = '/data/backups/myproject/dump_20260318.sql.gz';

      const result = await adapter.decrypt(filePath);

      expect(mockSafeExecFile).toHaveBeenCalledWith('gpg', [
        '--batch',
        '--yes',
        '--decrypt',
        '--output',
        expectedDecryptedPath,
        filePath,
      ]);
      expect(result).toBe(expectedDecryptedPath);
    });

    it('should propagate errors from safeExecFile', async () => {
      mockSafeExecFile.mockRejectedValueOnce(new Error('GPG decrypt failed'));

      await expect(adapter.decrypt('/some/file.sql.gz.gpg')).rejects.toThrow(
        'GPG decrypt failed',
      );
    });
  });
});
