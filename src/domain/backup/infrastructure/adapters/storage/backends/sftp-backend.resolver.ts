import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { StorageConfig } from '@domain/config/domain/storage-config.model';
import { ResticBackendDescriptor, ResticBackendResolver } from './restic-backend.resolver';

@Injectable()
export class SftpBackendResolver implements ResticBackendResolver {
  constructor(private readonly configService: ConfigService) {}

  resolve(storage: StorageConfig): ResticBackendDescriptor {
    const host = this.configService.getOrThrow<string>('HETZNER_SSH_HOST');
    const user = this.configService.getOrThrow<string>('HETZNER_SSH_USER');
    const keyPath = this.configService.getOrThrow<string>('HETZNER_SSH_KEY_PATH');
    const port = parseInt(String(this.configService.get('HETZNER_SSH_PORT', '22')), 10);

    return {
      repository: `sftp:${user}@${host}:${storage.repository}`,
      env: {
        RESTIC_SSH_COMMAND: `ssh -i "${keyPath}" -p ${port} -o StrictHostKeyChecking=accept-new`,
      },
    };
  }
}
