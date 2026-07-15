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
