import { RunCommand } from '@domain/backup/presenters/cli/run.command';
import { RunBackupUseCase } from '@domain/backup/application/use-cases/run-backup/run-backup.use-case';
import { BackupResult } from '@domain/backup/domain/backup-result.model';
import { BackupStatus } from '@domain/backup/domain/value-objects/backup-status.enum';
import { BackupStage } from '@domain/backup/domain/value-objects/backup-stage.enum';

function buildResult(overrides: Partial<BackupResult> = {}): BackupResult {
  return new BackupResult({
    runId: 'run-1',
    projectName: 'test-project',
    status: BackupStatus.Success,
    currentStage: BackupStage.NotifyResult,
    startedAt: new Date(),
    completedAt: new Date(),
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
    durationMs: 5000,
    ...overrides,
  });
}

describe('RunCommand', () => {
  let command: RunCommand;
  let runBackup: jest.Mocked<RunBackupUseCase>;

  beforeEach(() => {
    runBackup = {
      execute: jest.fn(),
      getDryRunReport: jest.fn(),
    } as unknown as jest.Mocked<RunBackupUseCase>;

    command = new RunCommand(runBackup);
    process.exitCode = undefined;
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('should call execute with project name', async () => {
    runBackup.execute.mockResolvedValue([buildResult({ projectName: 'my-project' })]);

    await command.run(['my-project'], {});

    expect(runBackup.execute).toHaveBeenCalledWith(
      expect.objectContaining({ projectName: 'my-project' }),
    );
  });

  it('should call execute with isAll when --all is set', async () => {
    runBackup.execute.mockResolvedValue([buildResult()]);

    await command.run([], { all: true });

    expect(runBackup.execute).toHaveBeenCalledWith(
      expect.objectContaining({ isAll: true }),
    );
  });

  it('should set exit code 2 when backup already in progress', async () => {
    runBackup.execute.mockRejectedValue(new Error('Backup already in progress for test'));

    await command.run(['test'], {});

    expect(process.exitCode).toBe(2);
  });

  it('should set exit code 5 on partial success', async () => {
    runBackup.execute.mockResolvedValue([
      buildResult({ projectName: 'a', status: BackupStatus.Success }),
      buildResult({ projectName: 'b', status: BackupStatus.Failed }),
    ]);

    await command.run([], { all: true });

    expect(process.exitCode).toBe(5);
  });

  it('should set exit code 1 on total failure', async () => {
    runBackup.execute.mockResolvedValue([
      buildResult({ projectName: 'a', status: BackupStatus.Failed }),
      buildResult({ projectName: 'b', status: BackupStatus.Failed }),
    ]);

    await command.run([], { all: true });

    expect(process.exitCode).toBe(1);
  });

  it('should set exit code 1 on single backup failure', async () => {
    runBackup.execute.mockResolvedValue([
      buildResult({ status: BackupStatus.Failed }),
    ]);

    await command.run(['test'], {});

    expect(process.exitCode).toBe(1);
  });

  it('should call getDryRunReport for --dry-run instead of execute', async () => {
    runBackup.getDryRunReport.mockResolvedValue({
      projectName: 'test',
      checks: [{ name: 'Config loaded', passed: true, message: 'OK' }],
      allPassed: true,
    });

    await command.run(['test'], { dryRun: true });

    expect(runBackup.getDryRunReport).toHaveBeenCalledWith('test');
    expect(runBackup.execute).not.toHaveBeenCalled();
  });

  it('should set exit code 1 when project name is missing without --all', async () => {
    await command.run([], {});

    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('project name is required'),
    );
  });
});
