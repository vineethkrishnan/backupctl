import { BackupResult } from '@domain/backup/domain/backup-result.model';
import { BackupStageError } from '@domain/backup/domain/backup-stage-error';

export interface NotifierPort {
  notifyStarted(projectName: string): Promise<void>;
  notifySuccess(result: BackupResult): Promise<void>;
  notifyFailure(projectName: string, error: BackupStageError): Promise<void>;
  notifyWarning(projectName: string, message: string): Promise<void>;
  notifyDailySummary(results: BackupResult[]): Promise<void>;
}
