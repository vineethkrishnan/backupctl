import { RunCommand } from '@infrastructure/cli/commands/run.command';
import { BackupOrchestratorService } from '@application/backup/backup-orchestrator.service';
import { BackupResult } from '@domain/backup/models/backup-result.model';
import { BackupStatus } from '@domain/backup/models/backup-status.enum';
import { BackupStage } from '@domain/backup/models/backup-stage.enum';

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
  let orchestrator: jest.Mocked<BackupOrchestratorService>;

  beforeEach(() => {
    orchestrator = {
      runBackup: jest.fn(),
      runAllBackups: jest.fn(),
    } as unknown as jest.Mocked<BackupOrchestratorService>;

    command = new RunCommand(orchestrator);
    process.exitCode = undefined;
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('should call runBackup with project name', async () => {
    orchestrator.runBackup.mockResolvedValue(buildResult());

    await command.run(['my-project'], {});

    expect(orchestrator.runBackup).toHaveBeenCalledWith('my-project');
  });

  it('should call runAllBackups when --all is set', async () => {
    orchestrator.runAllBackups.mockResolvedValue([buildResult()]);

    await command.run([], { all: true });

    expect(orchestrator.runAllBackups).toHaveBeenCalled();
  });

  it('should set exit code 2 when backup already in progress', async () => {
    orchestrator.runBackup.mockRejectedValue(new Error('Backup already in progress for test'));

    await command.run(['test'], {});

    expect(process.exitCode).toBe(2);
  });

  it('should set exit code 5 on partial success', async () => {
    orchestrator.runAllBackups.mockResolvedValue([
      buildResult({ projectName: 'a', status: BackupStatus.Success }),
      buildResult({ projectName: 'b', status: BackupStatus.Failed }),
    ]);

    await command.run([], { all: true });

    expect(process.exitCode).toBe(5);
  });

  it('should set exit code 1 on total failure', async () => {
    orchestrator.runAllBackups.mockResolvedValue([
      buildResult({ projectName: 'a', status: BackupStatus.Failed }),
      buildResult({ projectName: 'b', status: BackupStatus.Failed }),
    ]);

    await command.run([], { all: true });

    expect(process.exitCode).toBe(1);
  });

  it('should set exit code 1 on single backup failure', async () => {
    orchestrator.runBackup.mockResolvedValue(
      buildResult({ status: BackupStatus.Failed }),
    );

    await command.run(['test'], {});

    expect(process.exitCode).toBe(1);
  });

  it('should call executeDryRun for --dry-run instead of runBackup', async () => {
    orchestrator.executeDryRun = jest.fn().mockResolvedValue({
      projectName: 'test',
      checks: [{ name: 'Config loaded', passed: true, message: 'OK' }],
      allPassed: true,
    });

    await command.run(['test'], { dryRun: true });

    expect(orchestrator.executeDryRun).toHaveBeenCalledWith('test');
    expect(orchestrator.runBackup).not.toHaveBeenCalled();
  });

  it('should set exit code 1 when project name is missing without --all', async () => {
    await command.run([], {});

    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('project name is required'),
    );
  });
});
