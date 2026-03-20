import { LogsCommand } from '@domain/audit/presenters/cli/logs.command';
import { GetBackupStatusUseCase } from '@domain/audit/application/use-cases/get-backup-status/get-backup-status.use-case';
import { GetFailedLogsUseCase } from '@domain/audit/application/use-cases/get-failed-logs/get-failed-logs.use-case';
import { BackupResult } from '@domain/backup/domain/backup-result.model';
import { BackupStatus } from '@domain/backup/domain/value-objects/backup-status.enum';
import { BackupStage } from '@domain/backup/domain/value-objects/backup-stage.enum';

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
    backupType: 'database',
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
  let getBackupStatus: jest.Mocked<GetBackupStatusUseCase>;
  let getFailedLogs: jest.Mocked<GetFailedLogsUseCase>;

  beforeEach(() => {
    getBackupStatus = { execute: jest.fn() } as unknown as jest.Mocked<GetBackupStatusUseCase>;
    getFailedLogs = { execute: jest.fn() } as unknown as jest.Mocked<GetFailedLogsUseCase>;

    command = new LogsCommand(getBackupStatus, getFailedLogs);
    process.exitCode = undefined;
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('should show logs for a project', async () => {
    getBackupStatus.execute.mockResolvedValue([buildResult()]);

    await command.run(['test-project'], {});

    expect(getBackupStatus.execute).toHaveBeenCalledWith(
      expect.objectContaining({ projectName: 'test-project', limit: undefined }),
    );
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('success'));
  });

  it('should filter failed logs when --failed is set', async () => {
    getFailedLogs.execute.mockResolvedValue([
      buildResult({ status: BackupStatus.Failed, errorMessage: 'Dump timeout' }),
    ]);

    await command.run(['test-project'], { failed: true });

    expect(getFailedLogs.execute).toHaveBeenCalledWith(
      expect.objectContaining({ projectName: 'test-project', limit: undefined }),
    );
    expect(getBackupStatus.execute).not.toHaveBeenCalled();
  });

  it('should pass --last limit', async () => {
    getBackupStatus.execute.mockResolvedValue([]);

    await command.run(['test-project'], { last: 10 });

    expect(getBackupStatus.execute).toHaveBeenCalledWith(
      expect.objectContaining({ projectName: 'test-project', limit: 10 }),
    );
  });

  it('should print message when no entries found', async () => {
    getBackupStatus.execute.mockResolvedValue([]);

    await command.run(['test-project'], {});

    expect(console.log).toHaveBeenCalledWith('No log entries found for test-project.');
  });

  it('should set exit code 1 on error', async () => {
    getBackupStatus.execute.mockRejectedValue(new Error('Query failed'));

    await command.run(['test-project'], {});

    expect(process.exitCode).toBe(1);
  });
});
