import { BackupResult } from '../models/backup-result.model';
import { PruneResult } from '../models/prune-result.model';

export interface RestoreOptions {
  readonly only?: 'db' | 'assets';
  readonly decompress?: boolean;
}

export interface BackupUseCase {
  runBackup(projectName: string, options?: { dryRun?: boolean }): Promise<BackupResult>;
  runAllBackups(): Promise<BackupResult[]>;
  restoreBackup(
    projectName: string,
    snapshotId: string,
    targetPath: string,
    options?: RestoreOptions,
  ): Promise<void>;
  getRestoreGuide(projectName: string): string;
  pruneProject(projectName: string): Promise<PruneResult>;
  pruneAll(): Promise<PruneResult[]>;
}
