import { CleanupResult } from '@domain/backup/domain/value-objects/cleanup-result.model';

export interface LocalCleanupPort {
  cleanup(directory: string, retentionDays: number): Promise<CleanupResult>;
}
