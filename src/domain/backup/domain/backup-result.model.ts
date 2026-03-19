import { BackupStage } from './value-objects/backup-stage.enum';
import { BackupStatus } from './value-objects/backup-status.enum';
import { CleanupResult } from './value-objects/cleanup-result.model';
import { DumpResult } from './value-objects/dump-result.model';
import { PruneResult } from './value-objects/prune-result.model';
import { SyncResult } from './value-objects/sync-result.model';

export interface BackupResultParams {
  readonly runId: string;
  readonly projectName: string;
  readonly status: BackupStatus;
  readonly currentStage: BackupStage;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly dumpResult: DumpResult | null;
  readonly syncResult: SyncResult | null;
  readonly pruneResult: PruneResult | null;
  readonly cleanupResult: CleanupResult | null;
  readonly encrypted: boolean;
  readonly verified: boolean;
  readonly snapshotMode: 'combined' | 'separate';
  readonly errorStage: BackupStage | null;
  readonly errorMessage: string | null;
  readonly retryCount: number;
  readonly durationMs: number;
}

export class BackupResult {
  readonly runId: string;
  readonly projectName: string;
  readonly status: BackupStatus;
  readonly currentStage: BackupStage;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly dumpResult: DumpResult | null;
  readonly syncResult: SyncResult | null;
  readonly pruneResult: PruneResult | null;
  readonly cleanupResult: CleanupResult | null;
  readonly encrypted: boolean;
  readonly verified: boolean;
  readonly snapshotMode: 'combined' | 'separate';
  readonly errorStage: BackupStage | null;
  readonly errorMessage: string | null;
  readonly retryCount: number;
  readonly durationMs: number;

  constructor(params: BackupResultParams) {
    this.runId = params.runId;
    this.projectName = params.projectName;
    this.status = params.status;
    this.currentStage = params.currentStage;
    this.startedAt = params.startedAt;
    this.completedAt = params.completedAt;
    this.dumpResult = params.dumpResult;
    this.syncResult = params.syncResult;
    this.pruneResult = params.pruneResult;
    this.cleanupResult = params.cleanupResult;
    this.encrypted = params.encrypted;
    this.verified = params.verified;
    this.snapshotMode = params.snapshotMode;
    this.errorStage = params.errorStage;
    this.errorMessage = params.errorMessage;
    this.retryCount = params.retryCount;
    this.durationMs = params.durationMs;
  }
}
