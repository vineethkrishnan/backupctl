import { Injectable } from '@nestjs/common';

import { StorageConfig } from '@domain/config/domain/storage-config.model';
import { ResticBackendDescriptor, ResticBackendResolver } from './restic-backend.resolver';

@Injectable()
export class LocalBackendResolver implements ResticBackendResolver {
  resolve(storage: StorageConfig): ResticBackendDescriptor {
    return {
      repository: storage.repository,
      env: {},
    };
  }
}
