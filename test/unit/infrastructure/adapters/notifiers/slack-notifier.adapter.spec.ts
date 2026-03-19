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
      snapshotMode: 'combined',
      errorStage: null,
      errorMessage: null,
      retryCount: 0,
      durationMs: 192000,
      ...overrides,
    });
  }

  describe('notifyStarted', () => {
    it('should post correct text format to Slack', async () => {
      await adapter.notifyStarted('locaboo');

      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(mockedAxios.post).toHaveBeenCalledWith(webhookUrl, {
        text: expect.stringContaining('🔄 Backup started — locaboo'),
      });
      const payload = mockedAxios.post.mock.calls[0][1] as Record<string, string>;
      expect(payload.text).toContain('Time:');
    });
  });

  describe('notifySuccess', () => {
    it('should post formatted success message with dump size, snapshot, and duration', async () => {
      const result = createSuccessResult();

      await adapter.notifySuccess(result);

      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      const postedText = (mockedAxios.post.mock.calls[0][1] as Record<string, string>).text;
      expect(postedText).toContain('✅ Backup completed — locaboo');
      expect(postedText).toContain('Dump: 246.00 MB');
      expect(postedText).toContain('Encrypted: Yes');
      expect(postedText).toContain('Verified: Yes');
      expect(postedText).toContain('Snapshot: a1b2c3d4');
      expect(postedText).toContain('Mode: combined');
      expect(postedText).toContain('New files: 12');
      expect(postedText).toContain('Changed: 3');
      expect(postedText).toContain('Pruned: 2 snapshots');
      expect(postedText).toContain('Local cleaned: 1 files');
      expect(postedText).toContain('Duration: 3m 12s');
    });

    it('should handle missing optional results', async () => {
      const result = createSuccessResult({
        dumpResult: null,
        syncResult: null,
        pruneResult: null,
        cleanupResult: null,
      });

      await adapter.notifySuccess(result);

      const postedText = (mockedAxios.post.mock.calls[0][1] as Record<string, string>).text;
      expect(postedText).toContain('Dump: N/A');
      expect(postedText).not.toContain('Snapshot:');
    });
  });

  describe('notifyFailure', () => {
    it('should post formatted failure message with stage and error', async () => {
      const error = new BackupStageError(
        BackupStage.Sync,
        new Error('connection timeout to storage box'),
        true,
      );

      await adapter.notifyFailure('locaboo', error);

      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      const postedText = (mockedAxios.post.mock.calls[0][1] as Record<string, string>).text;
      expect(postedText).toContain('❌ Backup failed — locaboo');
      expect(postedText).toContain('Stage: sync');
      expect(postedText).toContain('Retryable: Yes');
      expect(postedText).toContain('Error: connection timeout to storage box');
    });

    it('should show non-retryable for non-retryable errors', async () => {
      const error = new BackupStageError(
        BackupStage.PreHook,
        new Error('hook script failed'),
        false,
      );

      await adapter.notifyFailure('locaboo', error);

      const postedText = (mockedAxios.post.mock.calls[0][1] as Record<string, string>).text;
      expect(postedText).toContain('Retryable: No');
    });
  });

  describe('notifyWarning', () => {
    it('should post warning message', async () => {
      await adapter.notifyWarning('locaboo', 'Backup timeout warning — locaboo');

      expect(mockedAxios.post).toHaveBeenCalledWith(webhookUrl, {
        text: '⚠️ Backup timeout warning — locaboo',
      });
    });
  });

  describe('notifyDailySummary', () => {
    it('should post formatted daily summary', async () => {
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
      const postedText = (mockedAxios.post.mock.calls[0][1] as Record<string, string>).text;
      expect(postedText).toContain('📊 Daily Backup Summary');
      expect(postedText).toContain('✅ locaboo');
      expect(postedText).toContain('✅ project-x');
      expect(postedText).toContain('❌ project-y — FAILED — restic sync timeout');
      expect(postedText).toContain('Total: 2/3 successful');
    });
  });
});
