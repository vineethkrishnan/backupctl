import { PruneCommand } from '@infrastructure/cli/commands/prune.command';
import { BackupOrchestratorService } from '@application/backup/backup-orchestrator.service';
import { PruneResult } from '@domain/backup/models/prune-result.model';

describe('PruneCommand', () => {
  let command: PruneCommand;
  let orchestrator: jest.Mocked<BackupOrchestratorService>;

  beforeEach(() => {
    orchestrator = {
      pruneProject: jest.fn(),
      pruneAll: jest.fn(),
    } as unknown as jest.Mocked<BackupOrchestratorService>;

    command = new PruneCommand(orchestrator);
    process.exitCode = undefined;
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('should call pruneProject for a specific project', async () => {
    orchestrator.pruneProject.mockResolvedValue(new PruneResult(3, '500 MB'));

    await command.run(['my-project'], {});

    expect(orchestrator.pruneProject).toHaveBeenCalledWith('my-project');
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('3 snapshot(s)'),
    );
  });

  it('should call pruneAll when --all is set', async () => {
    orchestrator.pruneAll.mockResolvedValue([
      new PruneResult(2, '300 MB'),
      new PruneResult(1, '200 MB'),
    ]);

    await command.run([], { all: true });

    expect(orchestrator.pruneAll).toHaveBeenCalled();
    expect(orchestrator.pruneProject).not.toHaveBeenCalled();
  });

  it('should set exit code 1 when project name missing without --all', async () => {
    await command.run([], {});

    expect(process.exitCode).toBe(1);
  });

  it('should set exit code 1 on error', async () => {
    orchestrator.pruneProject.mockRejectedValue(new Error('Prune failed'));

    await command.run(['test'], {});

    expect(process.exitCode).toBe(1);
  });
});
