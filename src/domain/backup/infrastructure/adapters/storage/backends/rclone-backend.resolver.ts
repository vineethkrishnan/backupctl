import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { StorageConfig } from '@domain/config/domain/storage-config.model';
import { ResticBackendDescriptor, ResticBackendResolver } from './restic-backend.resolver';

@Injectable()
export class RcloneBackendResolver implements ResticBackendResolver {
  constructor(private readonly configService: ConfigService) {}

  resolve(storage: StorageConfig): ResticBackendDescriptor {
    if (!storage.repository.includes(':')) {
      throw new Error(
        `Storage repository "${storage.repository}" is not a valid rclone target — ` +
          'expected "<remote>:<path>", e.g. "gdrive:backups/myproject".',
      );
    }

    const configPath =
      storage.config.config_path ?? this.configService.get<string>('RCLONE_CONFIG_PATH', '');

    return {
      repository: `rclone:${storage.repository}`,
      env: configPath ? { RCLONE_CONFIG: configPath } : {},
    };
  }
}
