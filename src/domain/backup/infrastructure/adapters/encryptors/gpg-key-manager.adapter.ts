import * as fs from 'fs';
import * as path from 'path';

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GpgKeyManagerPort } from '@domain/backup/application/ports/gpg-key-manager.port';
import { safeExecFile } from '@common/helpers/child-process.util';

@Injectable()
export class GpgKeyManagerAdapter implements GpgKeyManagerPort, OnModuleInit {
  private readonly logger = new Logger(GpgKeyManagerAdapter.name);
  private readonly gpgKeysDir: string;

  constructor(configService: ConfigService) {
    this.gpgKeysDir = configService.get<string>('GPG_KEYS_DIR', '/gpg-keys');
  }

  async onModuleInit(): Promise<void> {
    try {
      const imported = await this.importAllFromDirectory();
      if (imported.length > 0) {
        this.logger.log(`Auto-imported ${imported.length} GPG key(s) from ${this.gpgKeysDir}`);
      }
    } catch (error) {
      this.logger.warn(`Failed to auto-import GPG keys: ${(error as Error).message}`);
    }
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
      '--list-keys', '--keyid-format', 'long',
    ]);
    return stdout;
  }

  async hasKey(recipient: string): Promise<boolean> {
    try {
      const { stdout } = await safeExecFile('gpg', ['--list-keys', recipient], { timeout: 10000 });
      return stdout.length > 0;
    } catch {
      return false;
    }
  }
}
