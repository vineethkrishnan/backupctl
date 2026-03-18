import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThanOrEqual, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { AuditLogPort } from '@domain/audit/ports/audit-log.port';
import { BackupResult } from '@domain/backup/models/backup-result.model';
import { BackupStage } from '@domain/backup/models/backup-stage.enum';
import { BackupStatus } from '@domain/backup/models/backup-status.enum';
import { BackupLogEntity } from './entities/backup-log.entity';

@Injectable()
export class TypeormAuditLogAdapter implements AuditLogPort {
  constructor(
    @InjectRepository(BackupLogEntity)
    private readonly repository: Repository<BackupLogEntity>,
  ) {}

  async startRun(projectName: string): Promise<string> {
    const runId = uuidv4();

    const entity = this.repository.create({
      id: runId,
      projectName,
      status: BackupStatus.Started,
      startedAt: new Date(),
      currentStage: BackupStage.NotifyStarted,
    });

    await this.repository.save(entity);
    return runId;
  }

  async trackProgress(runId: string, stage: BackupStage): Promise<void> {
    await this.repository.update(runId, { currentStage: stage });
  }

  async finishRun(runId: string, result: BackupResult): Promise<void> {
    await this.repository.update(runId, {
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
    });
  }

  async findByProject(projectName: string, limit = 20): Promise<BackupResult[]> {
    const entities = await this.repository.find({
      where: { projectName },
      order: { startedAt: 'DESC' },
      take: limit,
    });

    return entities.map((entity) => this.toBackupResult(entity));
  }

  async findFailed(projectName: string, limit = 20): Promise<BackupResult[]> {
    const entities = await this.repository.find({
      where: { projectName, status: BackupStatus.Failed },
      order: { startedAt: 'DESC' },
      take: limit,
    });

    return entities.map((entity) => this.toBackupResult(entity));
  }

  async findSince(since: Date): Promise<BackupResult[]> {
    const entities = await this.repository.find({
      where: { startedAt: MoreThanOrEqual(since) },
      order: { startedAt: 'DESC' },
    });

    return entities.map((entity) => this.toBackupResult(entity));
  }

  async findOrphaned(): Promise<BackupResult[]> {
    const entities = await this.repository.find({
      where: {
        status: BackupStatus.Started,
        completedAt: IsNull(),
      },
      order: { startedAt: 'DESC' },
    });

    return entities.map((entity) => this.toBackupResult(entity));
  }

  // Map entity to domain model
  private toBackupResult(entity: BackupLogEntity): BackupResult {
    return new BackupResult({
      runId: entity.id,
      projectName: entity.projectName,
      status: entity.status as BackupStatus,
      currentStage: (entity.currentStage as BackupStage) ?? BackupStage.NotifyStarted,
      startedAt: entity.startedAt,
      completedAt: entity.completedAt,
      dumpResult: entity.dumpSizeBytes
        ? { filePath: '', sizeBytes: Number(entity.dumpSizeBytes), durationMs: 0 }
        : null,
      syncResult: entity.snapshotId
        ? {
            snapshotId: entity.snapshotId,
            filesNew: entity.filesNew ?? 0,
            filesChanged: entity.filesChanged ?? 0,
            bytesAdded: Number(entity.bytesAdded ?? 0),
            durationMs: 0,
          }
        : null,
      pruneResult: entity.pruneSnapshotsRemoved !== null
        ? { snapshotsRemoved: entity.pruneSnapshotsRemoved, spaceFreed: '' }
        : null,
      cleanupResult: entity.localFilesCleaned !== null
        ? { filesRemoved: entity.localFilesCleaned, spaceFreed: 0 }
        : null,
      encrypted: entity.encrypted,
      verified: entity.verified,
      snapshotMode: (entity.snapshotMode as 'combined' | 'separate') ?? 'combined',
      errorStage: (entity.errorStage as BackupStage) ?? null,
      errorMessage: entity.errorMessage,
      retryCount: entity.retryCount,
      durationMs: Number(entity.durationMs ?? 0),
    });
  }
}
