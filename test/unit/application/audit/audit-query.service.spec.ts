import { AuditQueryService } from '@application/audit/audit-query.service';
import { AuditLogPort } from '@domain/audit/ports/audit-log.port';
import { ConfigLoaderPort } from '@domain/config/ports/config-loader.port';
import { BackupResult } from '@domain/backup/models/backup-result.model';
import { BackupStatus } from '@domain/backup/models/backup-status.enum';
import { BackupStage } from '@domain/backup/models/backup-stage.enum';
import { ProjectConfig } from '@domain/config/models/project-config.model';
import { RetentionPolicy } from '@domain/config/models/retention-policy.model';

describe('AuditQueryService', () => {
  let service: AuditQueryService;
  let mockAuditLog: jest.Mocked<AuditLogPort>;
  let mockConfigLoader: jest.Mocked<ConfigLoaderPort>;

  const createResult = (projectName: string, runId: string): BackupResult =>
    new BackupResult({
      runId,
      projectName,
      status: BackupStatus.Success,
      currentStage: BackupStage.NotifyResult,
      startedAt: new Date('2026-03-18T02:00:00Z'),
      completedAt: new Date('2026-03-18T02:05:00Z'),
      dumpResult: null,
      syncResult: null,
      pruneResult: null,
      cleanupResult: null,
      encrypted: false,
      verified: false,
      snapshotMode: 'combined',
      errorStage: null,
      errorMessage: null,
      retryCount: 0,
      durationMs: 300000,
    });

  const createProjectConfig = (name: string): ProjectConfig =>
    new ProjectConfig({
      name,
      enabled: true,
      cron: '0 2 * * *',
      timeoutMinutes: null,
      database: { type: 'postgres', host: 'localhost', port: 5432, name: 'db', user: 'u', password: 'p' },
      compression: { enabled: true },
      assets: { paths: [] },
      restic: { repositoryPath: '/repo', password: 'secret', snapshotMode: 'combined' },
      retention: new RetentionPolicy(7, 7, 4, 6),
      encryption: null,
      hooks: null,
      verification: { enabled: false },
      notification: null,
    });

  beforeEach(() => {
    mockAuditLog = {
      startRun: jest.fn(),
      trackProgress: jest.fn(),
      finishRun: jest.fn(),
      findByProject: jest.fn(),
      findFailed: jest.fn(),
      findSince: jest.fn(),
      findOrphaned: jest.fn(),
    };

    mockConfigLoader = {
      loadAll: jest.fn(),
      getProject: jest.fn(),
      validate: jest.fn(),
      reload: jest.fn(),
    };

    service = new AuditQueryService(mockAuditLog, mockConfigLoader);
  });

  describe('getStatus', () => {
    it('delegates to findByProject when projectName is given', async () => {
      const results = [createResult('locaboo', 'run-1')];
      mockAuditLog.findByProject.mockResolvedValue(results);

      const status = await service.getStatus('locaboo', 5);

      expect(mockAuditLog.findByProject).toHaveBeenCalledWith('locaboo', 5);
      expect(status).toEqual(results);
    });

    it('aggregates results from all projects when no projectName', async () => {
      const projects = [createProjectConfig('locaboo'), createProjectConfig('webapp')];
      mockConfigLoader.loadAll.mockReturnValue(projects);
      mockAuditLog.findByProject
        .mockResolvedValueOnce([createResult('locaboo', 'run-1')])
        .mockResolvedValueOnce([createResult('webapp', 'run-2')]);

      const status = await service.getStatus(undefined, 10);

      expect(mockConfigLoader.loadAll).toHaveBeenCalled();
      expect(mockAuditLog.findByProject).toHaveBeenCalledTimes(2);
      expect(status).toHaveLength(2);
      expect(status[0].projectName).toBe('locaboo');
      expect(status[1].projectName).toBe('webapp');
    });
  });

  describe('getFailedLogs', () => {
    it('delegates to findFailed', async () => {
      const failedResults = [createResult('locaboo', 'run-fail')];
      mockAuditLog.findFailed.mockResolvedValue(failedResults);

      const result = await service.getFailedLogs('locaboo', 3);

      expect(mockAuditLog.findFailed).toHaveBeenCalledWith('locaboo', 3);
      expect(result).toEqual(failedResults);
    });
  });
});
