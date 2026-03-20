import { Injectable } from '@nestjs/common';

import { BackupResult, BackupType } from '@domain/backup/domain/backup-result.model';
import { BackupStage } from '@domain/backup/domain/value-objects/backup-stage.enum';
import { BackupStatus } from '@domain/backup/domain/value-objects/backup-status.enum';
import { BackupLogRecord } from '../schema/backup-log.record';

@Injectable()
export class BackupLogMapper {
  toDomain(record: BackupLogRecord): BackupResult {
    const status = this.validateEnum(record.status, Object.values(BackupStatus), BackupStatus.Failed);
    const currentStage = record.currentStage
      ? this.validateEnum(record.currentStage, Object.values(BackupStage), BackupStage.NotifyStarted)
      : BackupStage.NotifyStarted;
    const errorStage = record.errorStage
      ? this.validateEnum(record.errorStage, Object.values(BackupStage), null)
      : null;

    return new BackupResult({
      runId: record.id,
      projectName: record.projectName,
      status,
      currentStage,
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
      backupType: this.normalizeBackupType(record.backupType),
      snapshotMode: (record.snapshotMode as 'combined' | 'separate') ?? 'combined',
      errorStage,
      errorMessage: record.errorMessage,
      retryCount: record.retryCount,
      durationMs: Number(record.durationMs ?? 0),
    });
  }

  private validateEnum<T>(value: string, validValues: T[], fallback: T): T {
    if (validValues.includes(value as T)) {
      return value as T;
    }
    return fallback;
  }

  private normalizeBackupType(value: string | null): BackupType {
    if (value === 'database' || value === 'assets' || value === 'database+assets') {
      return value;
    }
    return 'database';
  }

  toPartialRecord(result: BackupResult): Partial<BackupLogRecord> {
    return {
      status: result.status,
      completedAt: result.completedAt,
      currentStage: result.currentStage,
      dumpSizeBytes: result.dumpResult?.sizeBytes?.toString() ?? null,
      encrypted: result.encrypted,
      verified: result.verified,
      backupType: result.backupType,
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
