import { BackupResult } from '../../backup/models/backup-result.model';
import { BackupStage } from '../../backup/models/backup-stage.enum';

export interface AuditLogPort {
  startRun(projectName: string): Promise<string>;
  trackProgress(runId: string, stage: BackupStage): Promise<void>;
  finishRun(runId: string, result: BackupResult): Promise<void>;
  findByProject(projectName: string, limit?: number): Promise<BackupResult[]>;
  findFailed(projectName: string, limit?: number): Promise<BackupResult[]>;
  findSince(since: Date): Promise<BackupResult[]>;
  findOrphaned(): Promise<BackupResult[]>;
}
