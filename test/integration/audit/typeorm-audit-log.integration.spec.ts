import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { TypeormAuditLogAdapter } from '@infrastructure/persistence/audit/typeorm-audit-log.adapter';
import { BackupLogEntity } from '@infrastructure/persistence/audit/entities/backup-log.entity';
import { BackupStage } from '@domain/backup/models/backup-stage.enum';
import { BackupStatus } from '@domain/backup/models/backup-status.enum';
import { BackupResult } from '@domain/backup/models/backup-result.model';

jest.setTimeout(30000);

function buildBackupResult(overrides: Partial<BackupResult> = {}): BackupResult {
  return new BackupResult({
    runId: uuidv4(),
    projectName: 'locaboo',
    status: BackupStatus.Success,
    currentStage: BackupStage.NotifyResult,
    startedAt: new Date('2026-03-18T02:00:00Z'),
    completedAt: new Date('2026-03-18T02:05:00Z'),
    dumpResult: { filePath: '/data/backups/locaboo/dump.sql.gz', sizeBytes: 1024000, durationMs: 5000 },
    syncResult: { snapshotId: 'snap-abc123', filesNew: 2, filesChanged: 1, bytesAdded: 512000, durationMs: 8000 },
    pruneResult: { snapshotsRemoved: 1, spaceFreed: '100MB' },
    cleanupResult: { filesRemoved: 3, spaceFreed: 2048 },
    encrypted: false,
    verified: true,
    snapshotMode: 'combined',
    errorStage: null,
    errorMessage: null,
    retryCount: 0,
    durationMs: 300000,
    ...overrides,
  });
}

function createMockRepository(): jest.Mocked<Repository<BackupLogEntity>> {
  const store: BackupLogEntity[] = [];

  const mockRepo = {
    create: jest.fn((partial: Partial<BackupLogEntity>) => {
      const entity = new BackupLogEntity();
      Object.assign(entity, partial);
      return entity;
    }),

    save: jest.fn(async (entity: BackupLogEntity) => {
      const existingIndex = store.findIndex((e) => e.id === entity.id);
      if (existingIndex >= 0) {
        store[existingIndex] = entity;
      } else {
        store.push(entity);
      }
      return entity;
    }),

    update: jest.fn(async (id: string, partial: Partial<BackupLogEntity>) => {
      const entity = store.find((e) => e.id === id);
      if (entity) {
        Object.assign(entity, partial);
      }
      return { affected: entity ? 1 : 0 };
    }),

    find: jest.fn(async (options: {
      where: Record<string, unknown>;
      order?: Record<string, string>;
      take?: number;
    }) => {
      let results = [...store];

      // Filter by where conditions
      const where = options.where;
      if (where.projectName) {
        results = results.filter((e) => e.projectName === where.projectName);
      }
      if (where.status) {
        results = results.filter((e) => e.status === where.status);
      }
      if (where.completedAt === null || (typeof where.completedAt === 'object' && where.completedAt !== null)) {
        // IsNull() check
        if (where.completedAt === null) {
          results = results.filter((e) => e.completedAt === null || e.completedAt === undefined);
        }
      }
      if (where.startedAt && typeof where.startedAt === 'object' && '_type' in (where.startedAt as object)) {
        // MoreThanOrEqual — simplified
      }

      // Sort by startedAt DESC
      if (options.order?.startedAt === 'DESC') {
        results.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
      }

      // Limit
      if (options.take) {
        results = results.slice(0, options.take);
      }

      return results;
    }),
  } as unknown as jest.Mocked<Repository<BackupLogEntity>>;

  // Expose the store for assertions
  (mockRepo as unknown as { _store: BackupLogEntity[] })._store = store;

  return mockRepo;
}

describe('TypeormAuditLogAdapter (integration)', () => {
  let adapter: TypeormAuditLogAdapter;
  let repository: jest.Mocked<Repository<BackupLogEntity>>;

  beforeEach(() => {
    repository = createMockRepository();
    adapter = new TypeormAuditLogAdapter(repository);
  });

  describe('startRun', () => {
    it('should create a record with status=started', async () => {
      const runId = await adapter.startRun('locaboo');

      expect(runId).toBeDefined();
      expect(typeof runId).toBe('string');
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          projectName: 'locaboo',
          status: BackupStatus.Started,
          currentStage: BackupStage.NotifyStarted,
        }),
      );
      expect(repository.save).toHaveBeenCalled();
    });

    it('should assign a UUID as the runId', async () => {
      const runId = await adapter.startRun('locaboo');

      // UUID v4 format
      expect(runId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });
  });

  describe('trackProgress', () => {
    it('should update current_stage on the record', async () => {
      const runId = await adapter.startRun('locaboo');

      await adapter.trackProgress(runId, BackupStage.Dump);

      expect(repository.update).toHaveBeenCalledWith(runId, {
        currentStage: BackupStage.Dump,
      });
    });

    it('should track multiple stages sequentially', async () => {
      const runId = await adapter.startRun('locaboo');

      await adapter.trackProgress(runId, BackupStage.Dump);
      await adapter.trackProgress(runId, BackupStage.Verify);
      await adapter.trackProgress(runId, BackupStage.Sync);

      expect(repository.update).toHaveBeenCalledTimes(3);
      expect(repository.update).toHaveBeenLastCalledWith(runId, {
        currentStage: BackupStage.Sync,
      });
    });
  });

  describe('finishRun', () => {
    it('should update all fields on the record', async () => {
      const runId = await adapter.startRun('locaboo');
      const result = buildBackupResult({ runId });

      await adapter.finishRun(runId, result);

      expect(repository.update).toHaveBeenCalledWith(
        runId,
        expect.objectContaining({
          status: BackupStatus.Success,
          currentStage: BackupStage.NotifyResult,
          encrypted: false,
          verified: true,
          snapshotMode: 'combined',
          retryCount: 0,
        }),
      );
    });

    it('should persist dump and sync metadata', async () => {
      const runId = await adapter.startRun('locaboo');
      const result = buildBackupResult({ runId });

      await adapter.finishRun(runId, result);

      expect(repository.update).toHaveBeenCalledWith(
        runId,
        expect.objectContaining({
          dumpSizeBytes: '1024000',
          snapshotId: 'snap-abc123',
          filesNew: 2,
          filesChanged: 1,
          bytesAdded: '512000',
          pruneSnapshotsRemoved: 1,
          localFilesCleaned: 3,
        }),
      );
    });

    it('should handle failure result with error details', async () => {
      const runId = await adapter.startRun('locaboo');
      const result = buildBackupResult({
        runId,
        status: BackupStatus.Failed,
        errorStage: BackupStage.Dump,
        errorMessage: 'pg_dump connection refused',
        dumpResult: null,
        syncResult: null,
        pruneResult: null,
        cleanupResult: null,
      });

      await adapter.finishRun(runId, result);

      expect(repository.update).toHaveBeenCalledWith(
        runId,
        expect.objectContaining({
          status: BackupStatus.Failed,
          errorStage: BackupStage.Dump,
          errorMessage: 'pg_dump connection refused',
        }),
      );
    });
  });

  describe('findByProject', () => {
    it('should return results ordered by started_at DESC', async () => {
      // Insert two runs
      const runId1 = await adapter.startRun('locaboo');
      const store = (repository as unknown as { _store: BackupLogEntity[] })._store;
      const entity1 = store.find((e) => e.id === runId1);
      if (entity1) entity1.startedAt = new Date('2026-03-17T02:00:00Z');

      const runId2 = await adapter.startRun('locaboo');
      const entity2 = store.find((e) => e.id === runId2);
      if (entity2) entity2.startedAt = new Date('2026-03-18T02:00:00Z');

      const results = await adapter.findByProject('locaboo');

      expect(results).toHaveLength(2);
      expect(repository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectName: 'locaboo' },
          order: { startedAt: 'DESC' },
          take: 20,
        }),
      );
    });

    it('should respect the limit parameter', async () => {
      await adapter.startRun('locaboo');
      await adapter.startRun('locaboo');
      await adapter.startRun('locaboo');

      await adapter.findByProject('locaboo', 2);

      expect(repository.find).toHaveBeenCalledWith(
        expect.objectContaining({ take: 2 }),
      );
    });
  });

  describe('findOrphaned', () => {
    it('should return records with status=started and no completed_at', async () => {
      await adapter.startRun('locaboo');
      await adapter.startRun('shopify');

      const results = await adapter.findOrphaned();

      expect(repository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: BackupStatus.Started,
          }),
          order: { startedAt: 'DESC' },
        }),
      );
      // Both are started with no completedAt
      expect(results).toHaveLength(2);
    });
  });
});
