import { LogsCommand } from '@infrastructure/cli/commands/logs.command';
import { AuditQueryService } from '@application/audit/audit-query.service';
import { BackupResult } from '@domain/backup/models/backup-result.model';
import { BackupStatus } from '@domain/backup/models/backup-status.enum';
import { BackupStage } from '@domain/backup/models/backup-stage.enum';

function buildResult(overrides: Partial<BackupResult> = {}): BackupResult {
  return new BackupResult({
    runId: 'run-1',
    projectName: 'test-project',
    status: BackupStatus.Success,
    currentStage: BackupStage.NotifyResult,
    startedAt: new Date('2026-03-18T10:00:00Z'),
    completedAt: new Date('2026-03-18T10:05:00Z'),
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
    ...overrides,
  });
}

describe('LogsCommand', () => {
  let command: LogsCommand;
  let auditQuery: jest.Mocked<AuditQueryService>;

  beforeEach(() => {
    auditQuery = {
      getStatus: jest.fn(),
      getFailedLogs: jest.fn(),
    } as unknown as jest.Mocked<AuditQueryService>;

    command = new LogsCommand(auditQuery);
    process.exitCode = undefined;
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('should show logs for a project', async () => {
    auditQuery.getStatus.mockResolvedValue([buildResult()]);

    await command.run(['test-project'], {});

    expect(auditQuery.getStatus).toHaveBeenCalledWith('test-project', undefined);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('success'));
  });

  it('should filter failed logs when --failed is set', async () => {
    auditQuery.getFailedLogs.mockResolvedValue([
      buildResult({ status: BackupStatus.Failed, errorMessage: 'Dump timeout' }),
    ]);

    await command.run(['test-project'], { failed: true });

    expect(auditQuery.getFailedLogs).toHaveBeenCalledWith('test-project', undefined);
    expect(auditQuery.getStatus).not.toHaveBeenCalled();
  });

  it('should pass --last limit', async () => {
    auditQuery.getStatus.mockResolvedValue([]);

    await command.run(['test-project'], { last: 10 });

    expect(auditQuery.getStatus).toHaveBeenCalledWith('test-project', 10);
  });

  it('should print message when no entries found', async () => {
    auditQuery.getStatus.mockResolvedValue([]);

    await command.run(['test-project'], {});

    expect(console.log).toHaveBeenCalledWith('No log entries found for test-project.');
  });

  it('should set exit code 1 on error', async () => {
    auditQuery.getStatus.mockRejectedValue(new Error('Query failed'));

    await command.run(['test-project'], {});

    expect(process.exitCode).toBe(1);
  });
});
