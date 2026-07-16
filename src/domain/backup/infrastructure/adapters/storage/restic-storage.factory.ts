import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { RemoteStorageFactoryPort } from '@domain/backup/application/ports/remote-storage-factory.port';
import { RemoteStoragePort } from '@domain/backup/application/ports/remote-storage.port';
import { ProjectConfig } from '@domain/config/domain/project-config.model';
import { ResticBackendRegistry } from './backends/restic-backend.registry';
import { ResticStorageAdapter } from './restic-storage.adapter';

@Injectable()
export class ResticStorageFactory implements RemoteStorageFactoryPort {
  constructor(
    private readonly configService: ConfigService,
    private readonly backendRegistry: ResticBackendRegistry,
  ) {}

  create(config: ProjectConfig): RemoteStoragePort {
    const globalPassword = this.configService.get<string>('RESTIC_PASSWORD', '');
    const password = config.storage.password || globalPassword;

    if (!password) {
      throw new Error(
        `Restic password not configured for project "${config.name}". ` +
        'Set storage.password in projects.yml or RESTIC_PASSWORD in .env.',
      );
    }

    const backend = this.backendRegistry.resolve(config.storage.type).resolve(config.storage);

    return new ResticStorageAdapter(backend.repository, password, backend.env, config.name);
  }
}
