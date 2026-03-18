import { BackupStage } from '@domain/backup/models/backup-stage.enum';
import { evaluateRetry } from '@domain/backup/policies/retry.policy';

describe('evaluateRetry', () => {
  describe('retryable stages', () => {
    it('returns shouldRetry true with correct delay for Dump stage when attempt < maxRetries', () => {
      const result = evaluateRetry(BackupStage.Dump, 1, 3, 1000);

      expect(result.shouldRetry).toBe(true);
      expect(result.delayMs).toBe(1000);
    });

    it('returns delay 1000 for Sync stage with attempt 1, maxRetries 3, baseDelayMs 1000', () => {
      const result = evaluateRetry(BackupStage.Sync, 1, 3, 1000);

      expect(result.shouldRetry).toBe(true);
      expect(result.delayMs).toBe(1000);
    });

    it('returns delay 2000 for retryable stage with attempt 2 and baseDelayMs 1000', () => {
      const result = evaluateRetry(BackupStage.Dump, 2, 3, 1000);

      expect(result.shouldRetry).toBe(true);
      expect(result.delayMs).toBe(2000);
    });

    it('returns delay 4000 for retryable stage with attempt 3, maxRetries 4, baseDelayMs 1000', () => {
      const result = evaluateRetry(BackupStage.Dump, 3, 4, 1000);

      expect(result.shouldRetry).toBe(true);
      expect(result.delayMs).toBe(4000);
    });

    it('returns shouldRetry false when attempt equals maxRetries', () => {
      const result = evaluateRetry(BackupStage.Dump, 3, 3, 1000);

      expect(result.shouldRetry).toBe(false);
      expect(result.delayMs).toBe(0);
    });

    it('returns shouldRetry false when attempt exceeds maxRetries', () => {
      const result = evaluateRetry(BackupStage.Dump, 4, 3, 1000);

      expect(result.shouldRetry).toBe(false);
      expect(result.delayMs).toBe(0);
    });
  });

  describe('non-retryable stages', () => {
    it('returns shouldRetry false for PreHook regardless of attempt', () => {
      const result = evaluateRetry(BackupStage.PreHook, 1, 3, 1000);

      expect(result.shouldRetry).toBe(false);
      expect(result.delayMs).toBe(0);
    });

    it('returns shouldRetry false for PostHook', () => {
      const result = evaluateRetry(BackupStage.PostHook, 1, 3, 1000);

      expect(result.shouldRetry).toBe(false);
      expect(result.delayMs).toBe(0);
    });

    it('returns shouldRetry false for Audit', () => {
      const result = evaluateRetry(BackupStage.Audit, 1, 3, 1000);

      expect(result.shouldRetry).toBe(false);
      expect(result.delayMs).toBe(0);
    });

    it('returns shouldRetry false for NotifyResult', () => {
      const result = evaluateRetry(BackupStage.NotifyResult, 1, 3, 1000);

      expect(result.shouldRetry).toBe(false);
      expect(result.delayMs).toBe(0);
    });
  });

  describe('all retryable stages', () => {
    const RETRYABLE_STAGES = [
      BackupStage.Dump,
      BackupStage.Verify,
      BackupStage.Encrypt,
      BackupStage.Sync,
      BackupStage.Prune,
      BackupStage.Cleanup,
    ] as const;

    it.each(RETRYABLE_STAGES)(
      'returns shouldRetry true for %s when attempt < maxRetries',
      (stage) => {
        const result = evaluateRetry(stage, 1, 3, 1000);

        expect(result.shouldRetry).toBe(true);
        expect(result.delayMs).toBe(1000);
      },
    );
  });
});
