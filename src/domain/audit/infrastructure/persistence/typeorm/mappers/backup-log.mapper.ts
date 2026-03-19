import { Injectable } from '@nestjs/common';

import { BackupResult } from '@domain/backup/domain/backup-result.model';
import { BackupStage } from '@domain/backup/domain/value-objects/backup-stage.enum';
import { BackupStatus } from '@domain/backup/domain/value-objects/backup-status.enum';
import { BackupLogRecord } from '../schema/backup-log.record';

@Injectable()
export class BackupLogMapper {
  toDomain(record: BackupLogRecord): BackupResult {
    return new BackupResult({
      runId: record.id,
      projectName: record.projectName,
      status: record.status as BackupStatus,
      currentStage: (record.currentStage as BackupStage) ?? BackupStage.NotifyStarted,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      dumpResult: record.dumpSizeBytes
        ? { filePath: '', sizeBytes: Number(record.dumpSizeBytes), durationMs: 0 }
        : null,
      syncResult: record.snapshotId
        ? {
            snapshotId: record.snapshotId,
            filesNew: record.filesNew ?? 0,
            filesChanged: record.filesChanged ?? 0,
            bytesAdded: Number(record.bytesAdded ?? 0),
            durationMs: 0,
          }
        : null,
      pruneResult: record.pruneSnapshotsRemoved !== null
        ? { snapshotsRemoved: record.pruneSnapshotsRemoved, spaceFreed: '' }
        : null,
      cleanupResult: record.localFilesCleaned !== null
        ? { filesRemoved: record.localFilesCleaned, spaceFreed: 0 }
        : null,
      encrypted: record.encrypted,
      verified: record.verified,
      snapshotMode: (record.snapshotMode as 'combined' | 'separate') ?? 'combined',
      errorStage: (record.errorStage as BackupStage) ?? null,
      errorMessage: record.errorMessage,
      retryCount: record.retryCount,
      durationMs: Number(record.durationMs ?? 0),
    });
  }

  toPartialRecord(result: BackupResult): Partial<BackupLogRecord> {
    return {
      status: result.status,
      completedAt: result.completedAt,
      currentStage: result.currentStage,
      dumpSizeBytes: result.dumpResult?.sizeBytes?.toString() ?? null,
      encrypted: result.encrypted,
      verified: result.verified,
      snapshotId: result.syncResult?.snapshotId ?? null,
      snapshotMode: result.snapshotMode,
      filesNew: result.syncResult?.filesNew ?? null,
      filesChanged: result.syncResult?.filesChanged ?? null,
      bytesAdded: result.syncResult?.bytesAdded?.toString() ?? null,
      pruneSnapshotsRemoved: result.pruneResult?.snapshotsRemoved ?? null,
      localFilesCleaned: result.cleanupResult?.filesRemoved ?? null,
      errorStage: result.errorStage,
      errorMessage: result.errorMessage,
      retryCount: result.retryCount,
      durationMs: result.durationMs.toString(),
    };
  }
}
