import axios from 'axios';
import { WebhookNotifierAdapter } from '@infrastructure/adapters/notifiers/webhook-notifier.adapter';
import { BackupResult } from '@domain/backup/models/backup-result.model';
import { BackupStageError } from '@domain/backup/models/backup-stage-error';
import { BackupStage } from '@domain/backup/models/backup-stage.enum';
import { BackupStatus } from '@domain/backup/models/backup-status.enum';
import { DumpResult } from '@domain/backup/models/dump-result.model';
import { SyncResult } from '@domain/backup/models/sync-result.model';
import { PruneResult } from '@domain/backup/models/prune-result.model';
import { CleanupResult } from '@domain/backup/models/cleanup-result.model';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

interface WebhookPayload {
  event: string;
  project: string;
  text: string;
  data: Record<string, unknown>;
}

function getPayload(callIndex = 0): WebhookPayload {
  return mockedAxios.post.mock.calls[callIndex][1] as WebhookPayload;
}

describe('WebhookNotifierAdapter', () => {
  const webhookUrl = 'https://example.com/webhook';
  let adapter: WebhookNotifierAdapter;

  beforeEach(() => {
    adapter = new WebhookNotifierAdapter(webhookUrl);
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
    it('should post JSON with event=backup_started', async () => {
      await adapter.notifyStarted('locaboo');

      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      const url = mockedAxios.post.mock.calls[0][0];
      const config = mockedAxios.post.mock.calls[0][2];
      const payload = getPayload();
      expect(url).toBe(webhookUrl);
      expect(config).toEqual({ headers: { 'Content-Type': 'application/json' } });
      expect(payload).toMatchObject({
        event: 'backup_started',
        project: 'locaboo',
      });
      expect(payload.text).toContain('🔄 Backup started — locaboo');
      expect(payload.data).toHaveProperty('project_name', 'locaboo');
      expect(payload.data).toHaveProperty('timestamp');
    });
  });

  describe('notifySuccess', () => {
    it('should post JSON with text and data fields', async () => {
      const result = createSuccessResult();

      await adapter.notifySuccess(result);

      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      const payload = getPayload();

      expect(payload.event).toBe('backup_success');
      expect(payload.project).toBe('locaboo');

      // Verify text field contains formatted markdown
      expect(payload.text).toContain('✅ Backup completed — locaboo');
      expect(payload.text).toContain('Snapshot: a1b2c3d4');
      expect(payload.text).toContain('Duration: 3m 12s');

      // Verify data field includes structured backup result info
      expect(payload.data).toMatchObject({
        run_id: 'run-123',
        project_name: 'locaboo',
        status: 'success',
        snapshot_id: 'a1b2c3d4',
        dump_size_bytes: 257949696,
        encrypted: true,
        verified: true,
        duration_ms: 192000,
      });
      expect(payload.data).toHaveProperty('timestamp');
    });
  });

  describe('notifyFailure', () => {
    it('should post JSON with event=backup_failed', async () => {
      const error = new BackupStageError(
        BackupStage.Sync,
        new Error('connection timeout'),
        true,
      );

      await adapter.notifyFailure('locaboo', error);

      const payload = getPayload();
      expect(payload.event).toBe('backup_failed');
      expect(payload.project).toBe('locaboo');
      expect(payload.text).toContain('❌ Backup failed — locaboo');
      expect(payload.text).toContain('connection timeout');
      expect(payload.data).toMatchObject({
        project_name: 'locaboo',
        stage: BackupStage.Sync,
        is_retryable: true,
        error_message: 'connection timeout',
      });
    });
  });

  describe('notifyWarning', () => {
    it('should post JSON with event=backup_warning', async () => {
      await adapter.notifyWarning('locaboo', 'Backup exceeded timeout');

      const payload = getPayload();
      expect(payload.event).toBe('backup_warning');
      expect(payload.project).toBe('locaboo');
      expect(payload.text).toBe('⚠️ Backup exceeded timeout');
      expect(payload.data).toMatchObject({
        project_name: 'locaboo',
        message: 'Backup exceeded timeout',
      });
    });
  });

  describe('notifyDailySummary', () => {
    it('should post JSON with event=daily_summary', async () => {
      const results = [
        createSuccessResult(),
        createSuccessResult({
          projectName: 'project-y',
          status: BackupStatus.Failed,
          errorMessage: 'sync timeout',
          dumpResult: null,
          syncResult: null,
          pruneResult: null,
          cleanupResult: null,
        }),
      ];

      await adapter.notifyDailySummary(results);

      const payload = getPayload();
      expect(payload.event).toBe('daily_summary');
      expect(payload.project).toBe('all');
      expect(payload.text).toContain('📊 Daily Backup Summary');
      expect(payload.text).toContain('1/2 successful');
    });

    it('should include structured data with project details', async () => {
      const results = [
        createSuccessResult(),
        createSuccessResult({
          projectName: 'project-y',
          status: BackupStatus.Failed,
          errorMessage: 'sync timeout',
          dumpResult: null,
          syncResult: null,
          pruneResult: null,
          cleanupResult: null,
        }),
      ];

      await adapter.notifyDailySummary(results);

      const payload = getPayload();
      const payloadData = payload.data as Record<string, unknown>;
      expect(payloadData).toMatchObject({
        total: 2,
        successful: 1,
        failed: 1,
      });
      const projects = payloadData.projects as Record<string, unknown>[];
      expect(projects).toHaveLength(2);
      expect(projects[0]).toMatchObject({
        project_name: 'locaboo',
        status: 'success',
        snapshot_id: 'a1b2c3d4',
        dump_size_bytes: 257949696,
      });
      expect(projects[1]).toMatchObject({
        project_name: 'project-y',
        status: 'failed',
        error_message: 'sync timeout',
      });
    });
  });
});
