import { DumpEncryptorPort } from '@domain/backup/ports/dump-encryptor.port';
import { safeExecFile } from '@shared/child-process.util';

export class GpgEncryptorAdapter implements DumpEncryptorPort {
  constructor(private readonly recipient: string) {}

  async encrypt(filePath: string): Promise<string> {
    const outputPath = `${filePath}.gpg`;

    await safeExecFile('gpg', [
      '--batch',
      '--yes',
      '--encrypt',
      '--recipient',
      this.recipient,
      '--output',
      outputPath,
      filePath,
    ]);

    return outputPath;
  }

  async decrypt(filePath: string): Promise<string> {
    const decryptedPath = filePath.replace(/\.gpg$/, '');

    await safeExecFile('gpg', [
      '--batch',
      '--yes',
      '--decrypt',
      '--output',
      decryptedPath,
      filePath,
    ]);

    return decryptedPath;
  }
}
