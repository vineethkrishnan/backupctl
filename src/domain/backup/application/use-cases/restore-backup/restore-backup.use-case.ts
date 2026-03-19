import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

import { ConfigLoaderPort } from '@domain/config/application/ports/config-loader.port';
import { RemoteStorageFactory } from '@domain/backup/application/ports/remote-storage-factory.port';
import { CONFIG_LOADER_PORT, REMOTE_STORAGE_FACTORY } from '@common/di/injection-tokens';
import { safeExecFile } from '@common/helpers/child-process.util';
import { RestoreBackupCommand } from './restore-backup.command';

@Injectable()
export class RestoreBackupUseCase {
  private readonly baseDir: string;

  constructor(
    @Inject(CONFIG_LOADER_PORT) private readonly configLoader: ConfigLoaderPort,
    @Inject(REMOTE_STORAGE_FACTORY) private readonly storageFactory: RemoteStorageFactory,
    configService: ConfigService,
  ) {
    this.baseDir = configService.get<string>('BACKUP_BASE_DIR', '/data/backups');
  }

  async execute(command: RestoreBackupCommand): Promise<void> {
    const config = this.configLoader.getProject(command.projectName);
    const storage = this.storageFactory.create(config);
    const outputDir = path.join(this.baseDir, command.projectName);

    if (command.only === 'db') {
      await storage.restore(command.snapshotId, command.targetPath, [outputDir]);
    } else if (command.only === 'assets') {
      await storage.restore(command.snapshotId, command.targetPath, [...config.assets.paths]);
    } else {
      await storage.restore(command.snapshotId, command.targetPath);
    }

    if (command.decompress) {
      await this.decompressFiles(command.targetPath);
    }
  }

  private async decompressFiles(targetPath: string): Promise<void> {
    const entries = fs.readdirSync(targetPath);
    for (const entry of entries) {
      if (entry.endsWith('.gz')) {
        const filePath = path.join(targetPath, entry);
        await safeExecFile('gunzip', [filePath]);
      }
    }
  }
}
