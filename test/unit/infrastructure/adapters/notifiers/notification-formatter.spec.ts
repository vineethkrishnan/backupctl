import {
  extractSuccessDetail,
  buildDailySummaryEntries,
  formatFailureText,
  formatSuccessText,
  formatDailySummaryText,
} from '@domain/notification/infrastructure/notification-formatter.util';
import { BackupResult } from '@domain/backup/domain/backup-result.model';
import { BackupStatus } from '@domain/backup/domain/value-objects/backup-status.enum';
import { BackupStage } from '@domain/backup/domain/value-objects/backup-stage.enum';
import { BackupStageError } from '@domain/backup/domain/backup-stage-error';
import { DumpResult } from '@domain/backup/domain/value-objects/dump-result.model';
import { SyncResult } from '@domain/backup/domain/value-objects/sync-result.model';
import { PruneResult } from '@domain/backup/domain/value-objects/prune-result.model';
import { CleanupResult } from '@domain/backup/domain/value-objects/cleanup-result.model';

function createResult(overrides: Partial<{
  projectName: string;
  status: BackupStatus;
  dumpResult: DumpResult | null;
  syncResult: SyncResult | null;
  pruneResult: PruneResult | null;
  cleanupResult: CleanupResult | null;
  encrypted: boolean;
  verified: boolean;
  errorMessage: string | null;
  durationMs: number;
}> = {}): BackupResult {
  return new BackupResult({
    runId: 'run-1',
    projectName: overrides.projectName ?? 'test-project',
    status: overrides.status ?? BackupStatus.Success,
    currentStage: BackupStage.Audit,
    startedAt: new Date(),
    completedAt: new Date(),
    dumpResult: overrides.dumpResult ?? null,
    syncResult: overrides.syncResult ?? null,
    pruneResult: overrides.pruneResult ?? null,
    cleanupResult: overrides.cleanupResult ?? null,
    encrypted: overrides.encrypted ?? false,
    verified: overrides.verified ?? false,
    backupType: 'database',
    snapshotMode: 'combined',
    errorStage: null,
    errorMessage: overrides.errorMessage ?? null,
    retryCount: 0,
    durationMs: overrides.durationMs ?? 5000,
  });
}

describe('notification-formatter', () => {
  describe('extractSuccessDetail', () => {
    it('should extract basic fields with no optional results', () => {
      const result = createResult({ projectName: 'myproject', encrypted: true, verified: true });
      const detail = extractSuccessDetail(result);

      expect(detail.dbName).toBe('myproject');
      expect(detail.dumpSize).toBe('N/A');
      expect(detail.encrypted).toBe('Yes');
      expect(detail.verified).toBe('Yes');
      expect(detail.snapshot).toBeNull();
      expect(detail.prune).toBeNull();
      expect(detail.cleanup).toBeNull();
    });

    it('should extract dump info and derive dbName from file path', () => {
      const dump = new DumpResult('/data/backups/mydb.sql.gz', 1024, 3000);
      const result = createResult({ dumpResult: dump });
      const detail = extractSuccessDetail(result);

      expect(detail.dbName).toBe('mydb');
      expect(detail.dumpSize).toBe('1.00 KB');
    });

    it('should extract sync, prune, and cleanup details', () => {
      const sync = new SyncResult('abc123', 5, 2, 2048, 1000);
      const prune = new PruneResult(3, '100 MB');
      const cleanup = new CleanupResult(7, 50000);
      const result = createResult({ syncResult: sync, pruneResult: prune, cleanupResult: cleanup });
      const detail = extractSuccessDetail(result);

      expect(detail.modeLabel).toBe('database');
      expect(detail.snapshot).toEqual({
        id: 'abc123',
        mode: 'combined',
        filesNew: 5,
        filesChanged: 2,
        bytesAdded: '2.00 KB',
      });
      expect(detail.prune).toEqual({ label: '3 snapshots' });
      expect(detail.cleanup).toEqual({ label: '7 files' });
    });
  });

  describe('buildDailySummaryEntries', () => {
    it('should build success entries', () => {
      const dump = new DumpResult('/data/db.sql.gz', 512, 1000);
      const sync = new SyncResult('snap-1', 1, 0, 512, 500);
      const result = createResult({ projectName: 'locaboo', dumpResult: dump, syncResult: sync });
      const entries = buildDailySummaryEntries([result]);

      expect(entries).toHaveLength(1);
      expect(entries[0]!.icon).toBe('✅');
      expect(entries[0]!.isSuccess).toBe(true);
      expect(entries[0]!.snapshotId).toBe('snap-1');
    });

    it('should build failure entries', () => {
      const result = createResult({
        projectName: 'shopify',
        status: BackupStatus.Failed,
        errorMessage: 'dump timed out',
      });
      const entries = buildDailySummaryEntries([result]);

      expect(entries[0]!.icon).toBe('❌');
      expect(entries[0]!.isSuccess).toBe(false);
      expect(entries[0]!.errorMessage).toBe('dump timed out');
    });

    it('should default error message to "unknown error"', () => {
      const result = createResult({ status: BackupStatus.Failed });
      const entries = buildDailySummaryEntries([result]);

      expect(entries[0]!.errorMessage).toBe('unknown error');
    });
  });

  describe('formatFailureText', () => {
    it('should format failure text with stage and retryable info', () => {
      const error = new BackupStageError(BackupStage.Dump, new Error('connection refused'), true);
      const text = formatFailureText('locaboo', error);

      expect(text).toContain('❌ Backup failed — locaboo');
      expect(text).toContain('Stage: dump');
      expect(text).toContain('Retryable: Yes');
      expect(text).toContain('Error: connection refused');
    });

    it('should show "No" for non-retryable errors', () => {
      const error = new BackupStageError(BackupStage.PreHook, new Error('script failed'), false);
      const text = formatFailureText('myproject', error);

      expect(text).toContain('Retryable: No');
    });
  });

  describe('formatSuccessText', () => {
    it('should produce plaintext success with all sections', () => {
      const dump = new DumpResult('/data/backups/locaboo.sql.gz', 1024 * 1024, 5000);
      const sync = new SyncResult('snap-abc', 10, 3, 2048, 2000);
      const prune = new PruneResult(2, '50 MB');
      const cleanup = new CleanupResult(5, 10000);
      const result = createResult({
        projectName: 'locaboo',
        dumpResult: dump,
        syncResult: sync,
        pruneResult: prune,
        cleanupResult: cleanup,
        encrypted: true,
        verified: true,
      });
      const text = formatSuccessText(result);

      expect(text).toContain('✅ Backup completed — locaboo');
      expect(text).toContain('DB: locaboo');
      expect(text).toContain('Encrypted: Yes');
      expect(text).toContain('Snapshot: snap-abc');
      expect(text).toContain('Pruned: 2 snapshots');
      expect(text).toContain('Local cleaned: 5 files');
    });

    it('should omit sync/prune/cleanup sections when absent', () => {
      const result = createResult({ projectName: 'minimal' });
      const text = formatSuccessText(result);

      expect(text).toContain('✅ Backup completed — minimal');
      expect(text).not.toContain('Snapshot:');
      expect(text).not.toContain('Pruned:');
    });
  });

  describe('formatDailySummaryText', () => {
    it('should produce daily summary with mixed results', () => {
      const success = createResult({ projectName: 'locaboo', durationMs: 5000 });
      const failure = createResult({
        projectName: 'shopify',
        status: BackupStatus.Failed,
        errorMessage: 'connection timeout',
      });
      const text = formatDailySummaryText([success, failure], '2026-03-19');

      expect(text).toContain('📊 Daily Backup Summary — 2026-03-19');
      expect(text).toContain('✅ locaboo');
      expect(text).toContain('❌ shopify — FAILED — connection timeout');
      expect(text).toContain('Total: 1/2 successful');
    });
  });
});
