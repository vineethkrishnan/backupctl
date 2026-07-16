export const STORAGE_BACKEND_TYPES = ['sftp', 's3', 'b2', 'rclone', 'local'] as const;

export type StorageBackendType = (typeof STORAGE_BACKEND_TYPES)[number];

export const SNAPSHOT_MODES = ['combined', 'separate'] as const;

export type SnapshotMode = (typeof SNAPSHOT_MODES)[number];

export interface StorageConfig {
  readonly type: StorageBackendType;
  readonly repository: string;
  readonly password: string;
  readonly snapshotMode: SnapshotMode;
  readonly config: Record<string, string>;
}

/**
 * Shared by config validation and the backend resolvers so the two cannot disagree
 * about what a backend needs.
 */
export const REQUIRED_STORAGE_CONFIG_KEYS: Record<StorageBackendType, readonly string[]> = {
  sftp: [],
  s3: ['endpoint', 'access_key_id', 'secret_access_key'],
  b2: ['account_id', 'account_key'],
  rclone: [],
  local: [],
};
