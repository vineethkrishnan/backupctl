import { CacheInfo } from '@domain/backup/domain/value-objects/cache-info.model';
import { PruneResult } from '@domain/backup/domain/value-objects/prune-result.model';
import { SnapshotInfo } from '@domain/backup/domain/value-objects/snapshot-info.model';
import { SyncResult } from '@domain/backup/domain/value-objects/sync-result.model';
import { RetentionPolicy } from '@domain/config/domain/retention-policy.model';

export interface SyncOptions {
  readonly tags: string[];
  readonly snapshotMode: 'combined' | 'separate';
}

export interface RemoteStoragePort {
  sync(paths: string[], options: SyncOptions): Promise<SyncResult>;
  prune(retention: RetentionPolicy): Promise<PruneResult>;
  listSnapshots(): Promise<SnapshotInfo[]>;
  restore(snapshotId: string, targetPath: string, includePaths?: string[]): Promise<void>;
  exec(args: string[]): Promise<string>;
  getCacheInfo(): Promise<CacheInfo>;
  clearCache(): Promise<void>;
  unlock(): Promise<void>;
}
