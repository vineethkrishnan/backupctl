import * as fs from 'fs';
import * as path from 'path';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { safeExecFile } from '@shared/child-process.util';

@Injectable()
export class GpgKeyManager {
  private readonly gpgKeysDir: string;

  constructor(configService: ConfigService) {
    this.gpgKeysDir = configService.get<string>('GPG_KEYS_DIR', '/gpg-keys');
  }

  async importKey(filePath: string): Promise<void> {
    await safeExecFile('gpg', ['--batch', '--import', filePath]);
  }

  async importAllFromDirectory(): Promise<string[]> {
    if (!fs.existsSync(this.gpgKeysDir)) {
      return [];
    }

    const entries = fs.readdirSync(this.gpgKeysDir);
    const keyFiles = entries.filter(
      (file) => file.endsWith('.gpg') || file.endsWith('.pub'),
    );

    const importedFiles: string[] = [];
    for (const keyFile of keyFiles) {
      const fullPath = path.join(this.gpgKeysDir, keyFile);
      await this.importKey(fullPath);
      importedFiles.push(fullPath);
    }

    return importedFiles;
  }

  async listKeys(): Promise<string> {
    const { stdout } = await safeExecFile('gpg', [
      '--list-keys',
      '--keyid-format',
      'long',
    ]);
    return stdout;
  }
}
