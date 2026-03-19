import { BackupStage } from '../value-objects/backup-stage.enum';

export interface RetryDecision {
  readonly shouldRetry: boolean;
  readonly delayMs: number;
}

const RETRYABLE_STAGES = new Set<BackupStage>([
  BackupStage.Dump,
  BackupStage.Verify,
  BackupStage.Encrypt,
  BackupStage.Sync,
  BackupStage.Prune,
  BackupStage.Cleanup,
]);

export function evaluateRetry(
  stage: BackupStage,
  attempt: number,
  maxRetries: number,
  baseDelayMs: number,
): RetryDecision {
  if (!RETRYABLE_STAGES.has(stage) || attempt >= maxRetries) {
    return { shouldRetry: false, delayMs: 0 };
  }

  const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
  return { shouldRetry: true, delayMs };
}
