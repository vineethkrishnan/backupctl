import axios from 'axios';
import { SlackNotifierAdapter } from '@domain/notification/infrastructure/slack-notifier.adapter';
import { BackupResult } from '@domain/backup/domain/backup-result.model';
import { BackupStageError } from '@domain/backup/domain/backup-stage-error';
import { BackupStage } from '@domain/backup/domain/value-objects/backup-stage.enum';
import { BackupStatus } from '@domain/backup/domain/value-objects/backup-status.enum';
import { DumpResult } from '@domain/backup/domain/value-objects/dump-result.model';
import { SyncResult } from '@domain/backup/domain/value-objects/sync-result.model';
import { PruneResult } from '@domain/backup/domain/value-objects/prune-result.model';
import { CleanupResult } from '@domain/backup/domain/value-objects/cleanup-result.model';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('SlackNotifierAdapter', () => {
  const webhookUrl = 'https://hooks.slack.com/services/TEST/WEBHOOK/URL';
  let adapter: SlackNotifierAdapter;

  beforeEach(() => {
    adapter = new SlackNotifierAdapter(webhookUrl);
    mockedAxios.post.mockResolvedValue({ status: 200 });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  function createSuccessResult(overrides?: Partial<ConstructorParameters<typeof BackupResult>[0]>): BackupResult {
    return new BackupResult({
      runId: 'run-123',
      projectName: 'locaboo',
      status: BackupStatus.Success,
      currentStage: BackupStage.NotifyResult,
      startedAt: new Date('2026-03-18T00:00:00Z'),
      completedAt: new Date('2026-03-18T00:03:12Z'),
      dumpResult: new DumpResult('/data/backups/locaboo/backup.sql.gz', 257949696, 45000),
      syncResult: new SyncResult('a1b2c3d4', 12, 3, 54525952, 120000),
      pruneResult: new PruneResult(2, '150 MB'),
      cleanupResult: new CleanupResult(1, 1048576),
      encrypted: true,
      verified: true,
      backupType: 'database',
      snapshotMode: 'combined',
      errorStage: null,
      errorMessage: null,
      retryCount: 0,
      durationMs: 192000,
      ...overrides,
    });
  }

  // ── Payload helpers ────────────────────────────────

  function getPayload(): Record<string, unknown> {
    return mockedAxios.post.mock.calls[0]![1] as Record<string, unknown>;
  }

  function getAttachment(): { color: string; blocks: unknown[] } {
    const { attachments } = getPayload() as { attachments: { color: string; blocks: unknown[] }[] };
    return attachments[0]!;
  }

  /** Serialise all blocks to a single string for content assertions */
  function allBlockText(): string {
    return JSON.stringify(getAttachment().blocks);
  }

  // ── notifyStarted ─────────────────────────────────

  describe('notifyStarted', () => {
    it('should post Block Kit message with blue sidebar', async () => {
      await adapter.notifyStarted('locaboo');

      expect(mockedAxios.post).toHaveBeenCalledTimes(1);

      const payload = getPayload();
      expect(payload.text).toBe(' ');

      expect(getAttachment().color).toBe('#3498db');

      const text = allBlockText();
      expect(text).toContain('Backup started');
      expect(text).toContain('locaboo');
    });

    it('should include timestamp in context block', async () => {
      await adapter.notifyStarted('locaboo');

      const text = allBlockText();
      expect(text).toContain('🕐');
    });
  });

  // ── notifySuccess ─────────────────────────────────

  describe('notifySuccess', () => {
    it('should post Block Kit message with green sidebar and structured fields', async () => {
      const result = createSuccessResult();

      await adapter.notifySuccess(result);

      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(getAttachment().color).toBe('#2ecc71');

      const text = allBlockText();
      expect(text).toContain('Backup completed');
      expect(text).toContain('locaboo');
      expect(text).toContain('246.00 MB');
      expect(text).toContain('🔒 Yes');
      expect(text).toContain('☑️ Yes');
      expect(text).toContain('a1b2c3d4');
      expect(text).toContain('database');
      expect(text).toContain('3m 12s');
    });

    it('should use minimal text to avoid duplicate with Block Kit', async () => {
      const result = createSuccessResult();
      await adapter.notifySuccess(result);

      const { text } = getPayload() as { text: string };
      expect(text).toBe(' ');
    });

    it('should include snapshot fields and added-bytes context', async () => {
      const result = createSuccessResult();
      await adapter.notifySuccess(result);

      const text = allBlockText();
      expect(text).toContain('Snapshot');
      expect(text).toContain('a1b2c3d4');
      expect(text).toContain('Mode');
      expect(text).toContain('New Files');
      expect(text).toContain('📦');
    });

    it('should include prune and cleanup fields', async () => {
      const result = createSuccessResult();
      await adapter.notifySuccess(result);

      const text = allBlockText();
      expect(text).toContain('Pruned');
      expect(text).toContain('2 snapshots');
      expect(text).toContain('Cleaned');
      expect(text).toContain('1 files');
    });

    it('should handle missing optional results gracefully', async () => {
      const result = createSuccessResult({
        dumpResult: null,
        syncResult: null,
        pruneResult: null,
        cleanupResult: null,
      });

      await adapter.notifySuccess(result);

      const text = allBlockText();
      expect(text).toContain('N/A');
      expect(text).not.toContain('Snapshot');
      expect(text).not.toContain('Pruned');
    });
  });

  // ── notifyFailure ─────────────────────────────────

  describe('notifyFailure', () => {
    it('should post Block Kit message with red sidebar and error in code block', async () => {
      const error = new BackupStageError(
        BackupStage.Sync,
        new Error('connection timeout to storage box'),
        true,
      );

      await adapter.notifyFailure('locaboo', error);

      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(getAttachment().color).toBe('#e74c3c');

      const text = allBlockText();
      expect(text).toContain('Backup failed');
      expect(text).toContain('locaboo');
      expect(text).toContain('sync');
      expect(text).toContain('connection timeout to storage box');
    });

    it('should use minimal text to avoid duplicate with Block Kit', async () => {
      const error = new BackupStageError(BackupStage.Sync, new Error('timeout'), true);
      await adapter.notifyFailure('locaboo', error);

      const { text } = getPayload() as { text: string };
      expect(text).toBe(' ');
    });

    it('should show retryable status in fields', async () => {
      const error = new BackupStageError(BackupStage.Sync, new Error('timeout'), true);
      await adapter.notifyFailure('locaboo', error);

      const text = allBlockText();
      expect(text).toContain('Retryable');
      expect(text).toContain('Yes');
    });

    it('should show non-retryable for non-retryable errors', async () => {
      const error = new BackupStageError(
        BackupStage.PreHook,
        new Error('hook script failed'),
        false,
      );

      await adapter.notifyFailure('locaboo', error);

      const text = allBlockText();
      expect(text).toContain('Retryable');

      // "No" appears in the Retryable field — verify via the fields block
      const blocks = getAttachment().blocks as { type: string; fields?: { text: string }[] }[];
      const fieldsBlock = blocks.find((b) => b.fields);
      const retryField = fieldsBlock?.fields?.find((f) => f.text.includes('Retryable'));
      expect(retryField?.text).toContain('No');
    });
  });

  // ── notifyWarning ─────────────────────────────────

  describe('notifyWarning', () => {
    it('should post Block Kit message with orange sidebar', async () => {
      await adapter.notifyWarning('locaboo', 'Backup timeout exceeded');

      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(getAttachment().color).toBe('#f39c12');

      const text = allBlockText();
      expect(text).toContain('Warning');
      expect(text).toContain('locaboo');
      expect(text).toContain('Backup timeout exceeded');
    });

    it('should use minimal text to avoid duplicate with Block Kit', async () => {
      await adapter.notifyWarning('locaboo', 'Backup timeout exceeded');

      const { text } = getPayload() as { text: string };
      expect(text).toBe(' ');
    });
  });

  // ── notifyDailySummary ────────────────────────────

  describe('notifyDailySummary', () => {
    it('should post summary with per-project results and totals', async () => {
      const results = [
        createSuccessResult(),
        createSuccessResult({
          projectName: 'project-x',
          dumpResult: new DumpResult('/data/backups/project-x/backup.sql.gz', 134217728, 30000),
          syncResult: new SyncResult('e5f6g7h8', 5, 1, 10485760, 60000),
          durationMs: 105000,
        }),
        createSuccessResult({
          projectName: 'project-y',
          status: BackupStatus.Failed,
          errorMessage: 'restic sync timeout',
          dumpResult: null,
          syncResult: null,
          pruneResult: null,
          cleanupResult: null,
        }),
      ];

      await adapter.notifyDailySummary(results);

      expect(mockedAxios.post).toHaveBeenCalledTimes(1);

      const text = allBlockText();
      expect(text).toContain('Daily Backup Summary');
      expect(text).toContain('locaboo');
      expect(text).toContain('project-x');
      expect(text).toContain('project-y');
      expect(text).toContain('restic sync timeout');
      expect(text).toContain('2/3');
    });

    it('should use green sidebar when all backups succeed', async () => {
      await adapter.notifyDailySummary([createSuccessResult()]);

      expect(getAttachment().color).toBe('#2ecc71');
    });

    it('should use red sidebar when any backup fails', async () => {
      const results = [
        createSuccessResult(),
        createSuccessResult({
          projectName: 'failed',
          status: BackupStatus.Failed,
          errorMessage: 'failed',
        }),
      ];

      await adapter.notifyDailySummary(results);

      expect(getAttachment().color).toBe('#e74c3c');
    });

    it('should show unknown error when errorMessage is null', async () => {
      const results = [
        createSuccessResult({
          projectName: 'project-z',
          status: BackupStatus.Failed,
          errorMessage: null,
          dumpResult: null,
          syncResult: null,
        }),
      ];

      await adapter.notifyDailySummary(results);

      const text = allBlockText();
      expect(text).toContain('unknown error');
    });

    it('should use minimal text to avoid duplicate with Block Kit', async () => {
      await adapter.notifyDailySummary([createSuccessResult()]);

      const { text } = getPayload() as { text: string };
      expect(text).toBe(' ');
    });
  });

  // ── Edge cases for optional success fields ────────

  describe('notifySuccess with missing optional results', () => {
    it('should show N/A when dumpResult is null', async () => {
      const result = createSuccessResult({ dumpResult: null });
      await adapter.notifySuccess(result);

      const text = allBlockText();
      expect(text).toContain('N/A');
    });

    it('should omit snapshot section when syncResult is null', async () => {
      const result = createSuccessResult({ syncResult: null });
      await adapter.notifySuccess(result);

      const text = allBlockText();
      expect(text).not.toContain('Snapshot');
    });

    it('should show only prune field when cleanupResult is null', async () => {
      const result = createSuccessResult({ cleanupResult: null });
      await adapter.notifySuccess(result);

      const text = allBlockText();
      expect(text).toContain('Pruned');
      expect(text).toContain('2 snapshots');
      expect(text).not.toContain('Cleaned');
    });

    it('should omit prune/cleanup section when both are null', async () => {
      const result = createSuccessResult({ pruneResult: null, cleanupResult: null });
      await adapter.notifySuccess(result);

      const text = allBlockText();
      expect(text).not.toContain('Pruned');
      expect(text).not.toContain('Cleaned');
    });
  });
});
