import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { RemoteStorageFactory as RemoteStorageFactoryPort } from '@domain/backup/application/ports/remote-storage-factory.port';
import { RemoteStoragePort } from '@domain/backup/application/ports/remote-storage.port';
import { ProjectConfig } from '@domain/config/domain/project-config.model';
import { ResticStorageAdapter } from './restic-storage.adapter';

@Injectable()
export class ResticStorageFactory implements RemoteStorageFactoryPort {
  constructor(private readonly configService: ConfigService) {}

  create(config: ProjectConfig): RemoteStoragePort {
    const sshHost = this.configService.getOrThrow<string>('HETZNER_SSH_HOST');
    const sshUser = this.configService.getOrThrow<string>('HETZNER_SSH_USER');
    const sshKeyPath = this.configService.getOrThrow<string>('HETZNER_SSH_KEY_PATH');
    const sshPort = this.configService.get<number>('HETZNER_SSH_PORT', 22);
    const globalPassword = this.configService.get<string>('RESTIC_PASSWORD', '');

    const password = config.restic.password || globalPassword;

    return new ResticStorageAdapter(
      config.restic.repositoryPath,
      password,
      sshHost,
      sshUser,
      sshKeyPath,
      config.name,
      sshPort,
    );
  }
}
