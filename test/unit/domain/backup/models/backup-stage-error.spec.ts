import { BackupStage } from '../../../../../src/domain/backup/models/backup-stage.enum';
import { BackupStageError } from '../../../../../src/domain/backup/models/backup-stage-error';

describe('BackupStageError', () => {
  it('should construct with stage, originalError, and isRetryable', () => {
    const originalError = new Error('connection refused');
    const error = new BackupStageError(BackupStage.Dump, originalError, true);

    expect(error.stage).toBe(BackupStage.Dump);
    expect(error.originalError).toBe(originalError);
    expect(error.isRetryable).toBe(true);
  });

  it('should propagate message from originalError', () => {
    const originalError = new Error('disk full');
    const error = new BackupStageError(BackupStage.Sync, originalError, false);

    expect(error.message).toBe('disk full');
  });

  it('should set name to BackupStageError', () => {
    const originalError = new Error('timeout');
    const error = new BackupStageError(BackupStage.Encrypt, originalError, true);

    expect(error.name).toBe('BackupStageError');
  });

  it('should set isRetryable to true for retryable stages', () => {
    const originalError = new Error('transient failure');
    const error = new BackupStageError(BackupStage.Dump, originalError, true);

    expect(error.isRetryable).toBe(true);
  });

  it('should set isRetryable to false for non-retryable stages', () => {
    const originalError = new Error('hook failed');
    const error = new BackupStageError(BackupStage.PreHook, originalError, false);

    expect(error.isRetryable).toBe(false);
  });

  it('should be an instance of Error', () => {
    const originalError = new Error('fail');
    const error = new BackupStageError(BackupStage.Cleanup, originalError, true);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(BackupStageError);
  });
});
