import { Injectable } from '@nestjs/common';

import { StorageBackendType } from '@domain/config/domain/storage-config.model';
import { ResticBackendResolver } from './restic-backend.resolver';
import { SftpBackendResolver } from './sftp-backend.resolver';
import { S3BackendResolver } from './s3-backend.resolver';
import { B2BackendResolver } from './b2-backend.resolver';
import { RcloneBackendResolver } from './rclone-backend.resolver';
import { LocalBackendResolver } from './local-backend.resolver';

@Injectable()
export class ResticBackendRegistry {
  private readonly resolvers: Record<StorageBackendType, ResticBackendResolver>;

  constructor(
    sftp: SftpBackendResolver,
    s3: S3BackendResolver,
    b2: B2BackendResolver,
    rclone: RcloneBackendResolver,
    local: LocalBackendResolver,
  ) {
    this.resolvers = { sftp, s3, b2, rclone, local };
  }

  resolve(type: StorageBackendType): ResticBackendResolver {
    const resolver = this.resolvers[type];

    if (!resolver) {
      throw new Error(
        `No storage backend registered for type: ${type} ` +
          `(expected one of: ${Object.keys(this.resolvers).join(', ')})`,
      );
    }

    return resolver;
  }
}
