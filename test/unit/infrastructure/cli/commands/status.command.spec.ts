import { StatusCommand } from '@infrastructure/cli/commands/status.command';
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

describe('StatusCommand', () => {
  let command: StatusCommand;
  let auditQuery: jest.Mocked<AuditQueryService>;

  beforeEach(() => {
    auditQuery = {
      getStatus: jest.fn(),
    } as unknown as jest.Mocked<AuditQueryService>;

    command = new StatusCommand(auditQuery);
    process.exitCode = undefined;
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('should show all project statuses when no project specified', async () => {
    auditQuery.getStatus.mockResolvedValue([
      buildResult({ projectName: 'project-a' }),
      buildResult({ projectName: 'project-b' }),
    ]);

    await command.run([], {});

    expect(auditQuery.getStatus).toHaveBeenCalledWith(undefined, undefined);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('project-a'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('project-b'));
  });

  it('should show specific project history with --last', async () => {
    auditQuery.getStatus.mockResolvedValue([buildResult()]);

    await command.run(['test-project'], { last: 5 });

    expect(auditQuery.getStatus).toHaveBeenCalledWith('test-project', 5);
  });

  it('should print message when no records found', async () => {
    auditQuery.getStatus.mockResolvedValue([]);

    await command.run([], {});

    expect(console.log).toHaveBeenCalledWith('No backup records found.');
  });

  it('should set exit code 1 on error', async () => {
    auditQuery.getStatus.mockRejectedValue(new Error('DB connection failed'));

    await command.run([], {});

    expect(process.exitCode).toBe(1);
  });
});
