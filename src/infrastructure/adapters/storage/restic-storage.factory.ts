import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { RemoteStoragePort } from '@domain/backup/ports/remote-storage.port';
import { ProjectConfig } from '@domain/config/models/project-config.model';
import { ResticStorageAdapter } from './restic-storage.adapter';

@Injectable()
export class ResticStorageFactory {
  constructor(private readonly configService: ConfigService) {}

  createStorage(config: ProjectConfig): RemoteStoragePort {
    const sshHost = this.configService.getOrThrow<string>('HETZNER_SSH_HOST');
    const sshUser = this.configService.getOrThrow<string>('HETZNER_SSH_USER');
    const sshKeyPath = this.configService.getOrThrow<string>('HETZNER_SSH_KEY_PATH');
    const globalPassword = this.configService.get<string>('RESTIC_PASSWORD', '');

    const password = config.restic.password || globalPassword;

    return new ResticStorageAdapter(
      config.restic.repositoryPath,
      password,
      sshHost,
      sshUser,
      sshKeyPath,
      config.name,
    );
  }
}
