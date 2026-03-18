import { CacheInfo } from '../models/cache-info.model';
import { PruneResult } from '../models/prune-result.model';
import { SnapshotInfo } from '../models/snapshot-info.model';
import { SyncResult } from '../models/sync-result.model';
import { RetentionPolicy } from '../../config/models/retention-policy.model';

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
