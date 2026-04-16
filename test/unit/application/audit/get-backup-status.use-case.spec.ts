import { GetBackupStatusUseCase } from '@domain/audit/application/use-cases/get-backup-status/get-backup-status.use-case';
import { GetBackupStatusQuery } from '@domain/audit/application/use-cases/get-backup-status/get-backup-status.query';
import { AuditLogPort } from '@domain/audit/application/ports/audit-log.port';
import { ConfigLoaderPort } from '@domain/config/application/ports/config-loader.port';
import { BackupResult } from '@domain/backup/domain/backup-result.model';
import { BackupStatus } from '@domain/backup/domain/value-objects/backup-status.enum';
import { BackupStage } from '@domain/backup/domain/value-objects/backup-stage.enum';
import { ProjectConfig } from '@domain/config/domain/project-config.model';
import { RetentionPolicy } from '@domain/config/domain/retention-policy.model';

describe('GetBackupStatusUseCase', () => {
  let useCase: GetBackupStatusUseCase;
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
      backupType: 'database',
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
      database: { type: 'postgres', host: 'localhost', port: 5432, name: 'db', user: 'u', password: 'p', dumpTimeoutMinutes: null },
      compression: { enabled: true },
      assets: { paths: [] },
      restic: { repositoryPath: '/repo', password: 'secret', snapshotMode: 'combined' },
      retention: new RetentionPolicy(7, 7, 4, 6),
      encryption: null,
      hooks: null,
      verification: { enabled: false },
      notification: null,
      monitor: null,
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

    useCase = new GetBackupStatusUseCase(mockAuditLog, mockConfigLoader);
  });

  it('delegates to findByProject when projectName is given', async () => {
    const results = [createResult('vinsware', 'run-1')];
    mockAuditLog.findByProject.mockResolvedValue(results);

    const status = await useCase.execute(new GetBackupStatusQuery({ projectName: 'vinsware', limit: 5 }));

    expect(mockAuditLog.findByProject).toHaveBeenCalledWith('vinsware', 5);
    expect(status).toEqual(results);
  });

  it('aggregates results from all projects when no projectName', async () => {
    const projects = [createProjectConfig('vinsware'), createProjectConfig('webapp')];
    mockConfigLoader.loadAll.mockReturnValue(projects);
    mockAuditLog.findByProject
      .mockResolvedValueOnce([createResult('vinsware', 'run-1')])
      .mockResolvedValueOnce([createResult('webapp', 'run-2')]);

    const status = await useCase.execute(new GetBackupStatusQuery({ limit: 10 }));

    expect(mockConfigLoader.loadAll).toHaveBeenCalled();
    expect(mockAuditLog.findByProject).toHaveBeenCalledTimes(2);
    expect(status).toHaveLength(2);
    expect(status[0].projectName).toBe('vinsware');
    expect(status[1].projectName).toBe('webapp');
  });
});
