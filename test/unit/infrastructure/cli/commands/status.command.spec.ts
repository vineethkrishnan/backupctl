import { StatusCommand } from '@domain/audit/presenters/cli/status.command';
import { GetBackupStatusUseCase } from '@domain/audit/application/use-cases/get-backup-status/get-backup-status.use-case';
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
    snapshotMode: 'combined',
    errorStage: null,
    errorMessage: null,
    retryCount: 0,
    durationMs: 300000,
    ...overrides,
  });
}

describe('StatusCommand', () => {
  let command: StatusCommand;
  let getBackupStatus: jest.Mocked<GetBackupStatusUseCase>;

  beforeEach(() => {
    getBackupStatus = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<GetBackupStatusUseCase>;

    command = new StatusCommand(getBackupStatus);
    process.exitCode = undefined;
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('should show all project statuses when no project specified', async () => {
    getBackupStatus.execute.mockResolvedValue([
      buildResult({ projectName: 'project-a' }),
      buildResult({ projectName: 'project-b' }),
    ]);

    await command.run([], {});

    expect(getBackupStatus.execute).toHaveBeenCalledWith(
      expect.objectContaining({ projectName: undefined, limit: undefined }),
    );
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('project-a'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('project-b'));
  });

  it('should show specific project history with --last', async () => {
    getBackupStatus.execute.mockResolvedValue([buildResult()]);

    await command.run(['test-project'], { last: 5 });

    expect(getBackupStatus.execute).toHaveBeenCalledWith(
      expect.objectContaining({ projectName: 'test-project', limit: 5 }),
    );
  });

  it('should print message when no records found', async () => {
    getBackupStatus.execute.mockResolvedValue([]);

    await command.run([], {});

    expect(console.log).toHaveBeenCalledWith('No backup records found.');
  });

  it('should set exit code 1 on error', async () => {
    getBackupStatus.execute.mockRejectedValue(new Error('DB connection failed'));

    await command.run([], {});

    expect(process.exitCode).toBe(1);
  });
});
