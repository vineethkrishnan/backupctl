import { BackupResult } from '../../backup/models/backup-result.model';

export interface AuditQueryUseCase {
  getStatus(projectName?: string, limit?: number): Promise<BackupResult[]>;
  getFailedLogs(projectName: string, limit?: number): Promise<BackupResult[]>;
}
