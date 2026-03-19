import { BackupStage } from './value-objects/backup-stage.enum';

export class BackupStageError extends Error {
  readonly stage: BackupStage;
  readonly originalError: Error;
  readonly isRetryable: boolean;

  constructor(stage: BackupStage, originalError: Error, isRetryable: boolean) {
    super(originalError.message);
    this.name = 'BackupStageError';
    this.stage = stage;
    this.originalError = originalError;
    this.isRetryable = isRetryable;
  }
}
