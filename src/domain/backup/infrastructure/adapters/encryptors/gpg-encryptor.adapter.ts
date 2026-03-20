import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DumpEncryptorPort } from '@domain/backup/application/ports/dump-encryptor.port';
import { safeExecFile } from '@common/helpers/child-process.util';

@Injectable()
export class GpgEncryptorAdapter implements DumpEncryptorPort {
  private readonly defaultRecipient: string;

  constructor(configService: ConfigService) {
    this.defaultRecipient = configService.get<string>('GPG_RECIPIENT', '');
  }

  async encrypt(filePath: string, recipient?: string): Promise<string> {
    const resolvedRecipient = recipient ?? this.defaultRecipient;
    if (!resolvedRecipient) {
      throw new Error('GPG recipient not configured. Set GPG_RECIPIENT in .env or project config.');
    }

    const outputPath = `${filePath}.gpg`;

    await safeExecFile('gpg', [
      '--batch', '--yes',
      '--trust-model', 'always',
      '--encrypt',
      '--recipient', resolvedRecipient,
      '--output', outputPath,
      filePath,
    ]);

    return outputPath;
  }

  async decrypt(filePath: string): Promise<string> {
    if (!filePath.endsWith('.gpg')) {
      throw new Error(`Cannot decrypt file without .gpg extension: ${filePath}`);
    }
    const decryptedPath = filePath.replace(/\.gpg$/, '');

    await safeExecFile('gpg', [
      '--batch', '--yes', '--decrypt',
      '--output', decryptedPath,
      filePath,
    ]);

    return decryptedPath;
  }
}
