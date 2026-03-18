import { CleanupResult } from '../models/cleanup-result.model';

export interface LocalCleanupPort {
  cleanup(directory: string, retentionDays: number): Promise<CleanupResult>;
}
