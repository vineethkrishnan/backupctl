import { GetFailedLogsUseCase } from '@domain/audit/application/use-cases/get-failed-logs/get-failed-logs.use-case';
import { GetFailedLogsQuery } from '@domain/audit/application/use-cases/get-failed-logs/get-failed-logs.query';
import { AuditLogPort } from '@domain/audit/application/ports/audit-log.port';
import { BackupResult } from '@domain/backup/domain/backup-result.model';
import { BackupStatus } from '@domain/backup/domain/value-objects/backup-status.enum';
import { BackupStage } from '@domain/backup/domain/value-objects/backup-stage.enum';

describe('GetFailedLogsUseCase', () => {
  let useCase: GetFailedLogsUseCase;
  let mockAuditLog: jest.Mocked<AuditLogPort>;

  const createResult = (projectName: string, runId: string): BackupResult =>
    new BackupResult({
      runId,
      projectName,
      status: BackupStatus.Failed,
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
      errorStage: BackupStage.Dump,
      errorMessage: 'Dump timeout',
      retryCount: 0,
      durationMs: 300000,
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

    useCase = new GetFailedLogsUseCase(mockAuditLog);
  });

  it('delegates to findFailed', async () => {
    const failedResults = [createResult('locaboo', 'run-fail')];
    mockAuditLog.findFailed.mockResolvedValue(failedResults);

    const result = await useCase.execute(new GetFailedLogsQuery({ projectName: 'locaboo', limit: 3 }));

    expect(mockAuditLog.findFailed).toHaveBeenCalledWith('locaboo', 3);
    expect(result).toEqual(failedResults);
  });
});
