import { Injectable } from '@nestjs/common';

import { StorageConfig } from '@domain/config/domain/storage-config.model';
import {
  ResticBackendDescriptor,
  ResticBackendResolver,
  requireStorageConfig,
} from './restic-backend.resolver';

@Injectable()
export class S3BackendResolver implements ResticBackendResolver {
  resolve(storage: StorageConfig): ResticBackendDescriptor {
    const endpoint = requireStorageConfig(storage, 'endpoint').replace(/\/+$/, '');
    const region = storage.config.region;

    return {
      repository: `s3:${endpoint}/${storage.repository}`,
      env: {
        AWS_ACCESS_KEY_ID: requireStorageConfig(storage, 'access_key_id'),
        AWS_SECRET_ACCESS_KEY: requireStorageConfig(storage, 'secret_access_key'),
        ...(region ? { AWS_DEFAULT_REGION: region } : {}),
      },
    };
  }
}
