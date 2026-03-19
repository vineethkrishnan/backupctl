import * as fs from 'fs';

import { ConfigService } from '@nestjs/config';

import { JsonlFallbackWriterAdapter } from '@domain/audit/infrastructure/persistence/fallback/jsonl-fallback-writer.adapter';
import { BackupResult } from '@domain/backup/domain/backup-result.model';
import { BackupStage } from '@domain/backup/domain/value-objects/backup-stage.enum';
import { BackupStatus } from '@domain/backup/domain/value-objects/backup-status.enum';

jest.mock('fs');
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'fallback-uuid-1234'),
}));

const mockFs = fs as jest.Mocked<typeof fs>;

function createConfigService(baseDir = '/data/backups'): ConfigService {
  return {
    get: jest.fn((key: string, defaultValue?: string) => {
      if (key === 'BACKUP_BASE_DIR') return baseDir;
      return defaultValue;
    }),
  } as unknown as ConfigService;
}

function createBackupResult(): BackupResult {
  return new BackupResult({
    runId: 'run-1',
    projectName: 'myproject',
    status: BackupStatus.Success,
    currentStage: BackupStage.NotifyResult,
    startedAt: new Date('2026-03-18T10:00:00Z'),
    completedAt: new Date('2026-03-18T10:05:00Z'),
    dumpResult: null,
    syncResult: null,
    pruneResult: null,
    cleanupResult: null,
    encrypted: false,
    verified: true,
    snapshotMode: 'combined',
    errorStage: null,
    errorMessage: null,
    retryCount: 0,
    durationMs: 300000,
  });
}

describe('JsonlFallbackWriterAdapter', () => {
  let adapter: JsonlFallbackWriterAdapter;
  const fallbackFile = '/data/backups/.fallback-audit/fallback.jsonl';
  const fallbackDir = '/data/backups/.fallback-audit';

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new JsonlFallbackWriterAdapter(createConfigService());
  });

  describe('writeAuditFallback', () => {
    it('should create fallback directory and append JSONL line', async () => {
      const result = createBackupResult();

      await adapter.writeAuditFallback(result);

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(fallbackDir, { recursive: true });
      expect(mockFs.appendFileSync).toHaveBeenCalledWith(
        fallbackFile,
        expect.stringContaining('"type":"audit"'),
        'utf-8',
      );
    });

    it('should include id, type, payload, and timestamp in the entry', async () => {
      const result = createBackupResult();

      await adapter.writeAuditFallback(result);

      const writtenLine = (mockFs.appendFileSync as jest.Mock).mock.calls[0][1] as string;
      const parsed = JSON.parse(writtenLine.trim());

      expect(parsed.id).toBe('fallback-uuid-1234');
      expect(parsed.type).toBe('audit');
      expect(parsed.payload).toBeDefined();
      expect(parsed.timestamp).toBeDefined();
    });
  });

  describe('writeNotificationFallback', () => {
    it('should append JSONL line with notification type', async () => {
      await adapter.writeNotificationFallback('slack', {
        channel: '#alerts',
        message: 'Backup failed',
      });

      expect(mockFs.appendFileSync).toHaveBeenCalledWith(
        fallbackFile,
        expect.stringContaining('"type":"notification"'),
        'utf-8',
      );

      const writtenLine = (mockFs.appendFileSync as jest.Mock).mock.calls[0][1] as string;
      const parsed = JSON.parse(writtenLine.trim());

      expect(parsed.payload.notificationType).toBe('slack');
      expect(parsed.payload.channel).toBe('#alerts');
    });
  });

  describe('readPendingEntries', () => {
    it('should return empty array when file does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false);

      const entries = await adapter.readPendingEntries();

      expect(entries).toEqual([]);
    });

    it('should read and parse JSONL file', async () => {
      mockFs.existsSync.mockReturnValue(true);

      const line1 = JSON.stringify({
        id: 'entry-1',
        type: 'audit',
        payload: {},
        timestamp: '2026-03-18T10:00:00.000Z',
      });
      const line2 = JSON.stringify({
        id: 'entry-2',
        type: 'notification',
        payload: { notificationType: 'slack' },
        timestamp: '2026-03-18T10:01:00.000Z',
      });

      mockFs.readFileSync.mockReturnValue(`${line1}\n${line2}\n`);

      const entries = await adapter.readPendingEntries();

      expect(entries).toHaveLength(2);
      expect(entries[0].id).toBe('entry-1');
      expect(entries[1].id).toBe('entry-2');
    });

    it('should return empty array for empty file', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('');

      const entries = await adapter.readPendingEntries();

      expect(entries).toEqual([]);
    });
  });

  describe('clearReplayed', () => {
    it('should remove matched entries and rewrite file', async () => {
      mockFs.existsSync.mockReturnValue(true);

      const line1 = JSON.stringify({
        id: 'entry-1',
        type: 'audit',
        payload: {},
        timestamp: '2026-03-18T10:00:00.000Z',
      });
      const line2 = JSON.stringify({
        id: 'entry-2',
        type: 'notification',
        payload: {},
        timestamp: '2026-03-18T10:01:00.000Z',
      });

      mockFs.readFileSync.mockReturnValue(`${line1}\n${line2}\n`);

      await adapter.clearReplayed(['entry-1']);

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        fallbackFile,
        expect.stringContaining('entry-2'),
        'utf-8',
      );
    });

    it('should delete file when all entries are cleared', async () => {
      mockFs.existsSync.mockReturnValue(true);

      const line1 = JSON.stringify({
        id: 'entry-1',
        type: 'audit',
        payload: {},
        timestamp: '2026-03-18T10:00:00.000Z',
      });

      mockFs.readFileSync.mockReturnValue(`${line1}\n`);

      await adapter.clearReplayed(['entry-1']);

      expect(mockFs.unlinkSync).toHaveBeenCalledWith(fallbackFile);
    });

    it('should do nothing when file does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false);

      await adapter.clearReplayed(['entry-1']);

      expect(mockFs.readFileSync).not.toHaveBeenCalled();
    });
  });
});
