import { Injectable } from '@nestjs/common';

import { StorageConfig } from '@domain/config/domain/storage-config.model';
import {
  ResticBackendDescriptor,
  ResticBackendResolver,
  requireStorageConfig,
} from './restic-backend.resolver';

@Injectable()
export class B2BackendResolver implements ResticBackendResolver {
  resolve(storage: StorageConfig): ResticBackendDescriptor {
    return {
      repository: `b2:${storage.repository}`,
      env: {
        B2_ACCOUNT_ID: requireStorageConfig(storage, 'account_id'),
        B2_ACCOUNT_KEY: requireStorageConfig(storage, 'account_key'),
      },
    };
  }
}
