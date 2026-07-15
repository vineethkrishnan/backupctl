import { StorageConfig } from '@domain/config/domain/storage-config.model';

export interface ResticBackendDescriptor {
  readonly repository: string;
  readonly env: Record<string, string>;
}

export interface ResticBackendResolver {
  resolve(storage: StorageConfig): ResticBackendDescriptor;
}

export function requireStorageConfig(storage: StorageConfig, key: string): string {
  const value = storage.config[key];

  if (!value) {
    throw new Error(
      `Storage type "${storage.type}" requires config.${key} — set it under storage.config in projects.yml.`,
    );
  }

  return value;
}
