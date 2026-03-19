import { BackupResult } from '@domain/backup/domain/backup-result.model';
import { BackupStage } from '@domain/backup/domain/value-objects/backup-stage.enum';

export interface AuditLogPort {
  startRun(projectName: string): Promise<string>;
  trackProgress(runId: string, stage: BackupStage): Promise<void>;
  finishRun(runId: string, result: BackupResult): Promise<void>;
  findByProject(projectName: string, limit?: number): Promise<BackupResult[]>;
  findFailed(projectName: string, limit?: number): Promise<BackupResult[]>;
  findSince(since: Date): Promise<BackupResult[]>;
  findOrphaned(): Promise<BackupResult[]>;
}
