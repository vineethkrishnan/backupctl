import {
  REQUIRED_STORAGE_CONFIG_KEYS,
  StorageConfig,
} from '@domain/config/domain/storage-config.model';

export interface ResticBackendDescriptor {
  readonly repository: string;
  readonly env: Record<string, string>;
}

export interface ResticBackendResolver {
  resolve(storage: StorageConfig): ResticBackendDescriptor;
}

/**
 * Reads a credential the backend declared as required. Keys come from
 * REQUIRED_STORAGE_CONFIG_KEYS, which config validation reads too, so a key cannot be
 * required at run time without also being rejected by `config validate`.
 */
export function requireStorageConfig(storage: StorageConfig, key: string): string {
  if (!REQUIRED_STORAGE_CONFIG_KEYS[storage.type].includes(key)) {
    throw new Error(
      `Storage type "${storage.type}" reads config.${key} but does not declare it required — ` +
        'add it to REQUIRED_STORAGE_CONFIG_KEYS so config validate rejects it too.',
    );
  }

  const value = storage.config[key];

  if (!value) {
    throw new Error(
      `Storage type "${storage.type}" requires config.${key} — set it under storage.config in projects.yml.`,
    );
  }

  return value;
}
