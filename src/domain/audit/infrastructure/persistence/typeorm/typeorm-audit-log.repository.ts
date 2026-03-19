import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThanOrEqual, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { AuditLogPort } from '@domain/audit/application/ports/audit-log.port';
import { BackupResult } from '@domain/backup/domain/backup-result.model';
import { BackupStage } from '@domain/backup/domain/value-objects/backup-stage.enum';
import { BackupStatus } from '@domain/backup/domain/value-objects/backup-status.enum';
import { BackupLogRecord } from './schema/backup-log.record';
import { BackupLogMapper } from './mappers/backup-log.mapper';

@Injectable()
export class TypeormAuditLogRepository implements AuditLogPort {
  constructor(
    @InjectRepository(BackupLogRecord)
    private readonly repository: Repository<BackupLogRecord>,
    private readonly mapper: BackupLogMapper,
  ) {}

  async startRun(projectName: string): Promise<string> {
    const runId = uuidv4();

    const record = this.repository.create({
      id: runId,
      projectName,
      status: BackupStatus.Started,
      startedAt: new Date(),
      currentStage: BackupStage.NotifyStarted,
    });

    await this.repository.save(record);
    return runId;
  }

  async trackProgress(runId: string, stage: BackupStage): Promise<void> {
    await this.repository.update(runId, { currentStage: stage });
  }

  async finishRun(runId: string, result: BackupResult): Promise<void> {
    await this.repository.update(runId, this.mapper.toPartialRecord(result));
  }

  async findByProject(projectName: string, limit = 20): Promise<BackupResult[]> {
    const records = await this.repository.find({
      where: { projectName },
      order: { startedAt: 'DESC' },
      take: limit,
    });

    return records.map((record) => this.mapper.toDomain(record));
  }

  async findFailed(projectName: string, limit = 20): Promise<BackupResult[]> {
    const records = await this.repository.find({
      where: { projectName, status: BackupStatus.Failed },
      order: { startedAt: 'DESC' },
      take: limit,
    });

    return records.map((record) => this.mapper.toDomain(record));
  }

  async findSince(since: Date): Promise<BackupResult[]> {
    const records = await this.repository.find({
      where: { startedAt: MoreThanOrEqual(since) },
      order: { startedAt: 'DESC' },
    });

    return records.map((record) => this.mapper.toDomain(record));
  }

  async findOrphaned(): Promise<BackupResult[]> {
    const records = await this.repository.find({
      where: {
        status: BackupStatus.Started,
        completedAt: IsNull(),
      },
      order: { startedAt: 'DESC' },
    });

    return records.map((record) => this.mapper.toDomain(record));
  }
}
