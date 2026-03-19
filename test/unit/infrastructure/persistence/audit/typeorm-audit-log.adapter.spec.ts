import { Repository } from 'typeorm';

import { TypeormAuditLogRepository } from '@domain/audit/infrastructure/persistence/typeorm/typeorm-audit-log.repository';
import { BackupLogRecord } from '@domain/audit/infrastructure/persistence/typeorm/schema/backup-log.record';
import { BackupResult } from '@domain/backup/domain/backup-result.model';
import { BackupStage } from '@domain/backup/domain/value-objects/backup-stage.enum';
import { BackupStatus } from '@domain/backup/domain/value-objects/backup-status.enum';
import { DumpResult } from '@domain/backup/domain/value-objects/dump-result.model';
import { SyncResult } from '@domain/backup/domain/value-objects/sync-result.model';
import { PruneResult } from '@domain/backup/domain/value-objects/prune-result.model';
import { CleanupResult } from '@domain/backup/domain/value-objects/cleanup-result.model';

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid-1234'),
}));

function createMockRepository() {
  return {
    create: jest.fn((entity: Partial<BackupLogRecord>) => entity as BackupLogRecord),
    save: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    find: jest.fn().mockResolvedValue([]),
  };
}

function createSampleEntity(overrides: Partial<BackupLogRecord> = {}): BackupLogRecord {
  return {
    id: 'run-id-1',
    projectName: 'myproject',
    status: BackupStatus.Success,
    currentStage: BackupStage.NotifyResult,
    startedAt: new Date('2026-03-18T10:00:00Z'),
    completedAt: new Date('2026-03-18T10:05:00Z'),
    dumpSizeBytes: '1048576',
    encrypted: true,
    verified: true,
    snapshotId: 'snap-abc123',
    snapshotMode: 'combined',
    filesNew: 5,
    filesChanged: 2,
    bytesAdded: '2097152',
    pruneSnapshotsRemoved: 3,
    localFilesCleaned: 4,
    errorStage: null,
    errorMessage: null,
    retryCount: 0,
    durationMs: '300000',
    createdAt: new Date('2026-03-18T10:00:00Z'),
    ...overrides,
  } as BackupLogRecord;
}

describe('TypeormAuditLogRepository', () => {
  let adapter: TypeormAuditLogRepository;
  let mockRepo: ReturnType<typeof createMockRepository>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRepo = createMockRepository();
    adapter = new TypeormAuditLogRepository(
      mockRepo as unknown as Repository<BackupLogRecord>,
    );
  });

  describe('startRun', () => {
    it('should insert a row with status=started and return the UUID', async () => {
      const runId = await adapter.startRun('myproject');

      expect(runId).toBe('test-uuid-1234');
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-uuid-1234',
          projectName: 'myproject',
          status: BackupStatus.Started,
          currentStage: BackupStage.NotifyStarted,
        }),
      );
      expect(mockRepo.save).toHaveBeenCalled();
    });
  });

  describe('trackProgress', () => {
    it('should update current_stage for the given runId', async () => {
      await adapter.trackProgress('run-id-1', BackupStage.Dump);

      expect(mockRepo.update).toHaveBeenCalledWith('run-id-1', {
        currentStage: BackupStage.Dump,
      });
    });
  });

  describe('finishRun', () => {
    it('should update all fields from BackupResult', async () => {
      const result = new BackupResult({
        runId: 'run-id-1',
        projectName: 'myproject',
        status: BackupStatus.Success,
        currentStage: BackupStage.NotifyResult,
        startedAt: new Date('2026-03-18T10:00:00Z'),
        completedAt: new Date('2026-03-18T10:05:00Z'),
        dumpResult: new DumpResult('/data/dump.sql.gz', 1048576, 5000),
        syncResult: new SyncResult('snap-abc123', 5, 2, 2097152, 10000),
        pruneResult: new PruneResult(3, '150 MB'),
        cleanupResult: new CleanupResult(4, 8192),
        encrypted: true,
        verified: true,
        snapshotMode: 'combined',
        errorStage: null,
        errorMessage: null,
        retryCount: 1,
        durationMs: 300000,
      });

      await adapter.finishRun('run-id-1', result);

      expect(mockRepo.update).toHaveBeenCalledWith('run-id-1', {
        status: BackupStatus.Success,
        completedAt: result.completedAt,
        currentStage: BackupStage.NotifyResult,
        dumpSizeBytes: '1048576',
        encrypted: true,
        verified: true,
        snapshotId: 'snap-abc123',
        snapshotMode: 'combined',
        filesNew: 5,
        filesChanged: 2,
        bytesAdded: '2097152',
        pruneSnapshotsRemoved: 3,
        localFilesCleaned: 4,
        errorStage: null,
        errorMessage: null,
        retryCount: 1,
        durationMs: '300000',
      });
    });

    it('should handle null sub-results', async () => {
      const result = new BackupResult({
        runId: 'run-id-2',
        projectName: 'myproject',
        status: BackupStatus.Failed,
        currentStage: BackupStage.Dump,
        startedAt: new Date('2026-03-18T10:00:00Z'),
        completedAt: new Date('2026-03-18T10:01:00Z'),
        dumpResult: null,
        syncResult: null,
        pruneResult: null,
        cleanupResult: null,
        encrypted: false,
        verified: false,
        snapshotMode: 'combined',
        errorStage: BackupStage.Dump,
        errorMessage: 'pg_dump failed',
        retryCount: 3,
        durationMs: 60000,
      });

      await adapter.finishRun('run-id-2', result);

      expect(mockRepo.update).toHaveBeenCalledWith('run-id-2', {
        status: BackupStatus.Failed,
        completedAt: result.completedAt,
        currentStage: BackupStage.Dump,
        dumpSizeBytes: null,
        encrypted: false,
        verified: false,
        snapshotId: null,
        snapshotMode: 'combined',
        filesNew: null,
        filesChanged: null,
        bytesAdded: null,
        pruneSnapshotsRemoved: null,
        localFilesCleaned: null,
        errorStage: BackupStage.Dump,
        errorMessage: 'pg_dump failed',
        retryCount: 3,
        durationMs: '60000',
      });
    });
  });

  describe('findByProject', () => {
    it('should query with correct where, order, and limit', async () => {
      const entity = createSampleEntity();
      mockRepo.find.mockResolvedValue([entity]);

      const results = await adapter.findByProject('myproject', 10);

      expect(mockRepo.find).toHaveBeenCalledWith({
        where: { projectName: 'myproject' },
        order: { startedAt: 'DESC' },
        take: 10,
      });
      expect(results).toHaveLength(1);
      expect(results[0]).toBeInstanceOf(BackupResult);
      expect(results[0].projectName).toBe('myproject');
    });

    it('should default to limit 20', async () => {
      mockRepo.find.mockResolvedValue([]);

      await adapter.findByProject('myproject');

      expect(mockRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ take: 20 }),
      );
    });
  });

  describe('findFailed', () => {
    it('should query with status=failed filter', async () => {
      mockRepo.find.mockResolvedValue([]);

      await adapter.findFailed('myproject', 5);

      expect(mockRepo.find).toHaveBeenCalledWith({
        where: { projectName: 'myproject', status: BackupStatus.Failed },
        order: { startedAt: 'DESC' },
        take: 5,
      });
    });
  });

  describe('findOrphaned', () => {
    it('should query for started status with null completed_at', async () => {
      const orphanedEntity = createSampleEntity({
        status: BackupStatus.Started,
        completedAt: null,
      });
      mockRepo.find.mockResolvedValue([orphanedEntity]);

      const results = await adapter.findOrphaned();

      expect(mockRepo.find).toHaveBeenCalledWith({
        where: {
          status: BackupStatus.Started,
          completedAt: expect.anything(),
        },
        order: { startedAt: 'DESC' },
      });
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe(BackupStatus.Started);
    });
  });

  describe('findSince', () => {
    it('should query with startedAt >= since', async () => {
      const since = new Date('2026-03-17T00:00:00Z');
      mockRepo.find.mockResolvedValue([]);

      await adapter.findSince(since);

      expect(mockRepo.find).toHaveBeenCalledWith({
        where: { startedAt: expect.anything() },
        order: { startedAt: 'DESC' },
      });
    });
  });
});
