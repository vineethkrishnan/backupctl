import { PruneCommand } from '@domain/backup/presenters/cli/prune.command';
import { PruneBackupUseCase } from '@domain/backup/application/use-cases/prune-backup/prune-backup.use-case';
import { PruneResult } from '@domain/backup/domain/value-objects/prune-result.model';

describe('PruneCommand', () => {
  let command: PruneCommand;
  let pruneBackup: jest.Mocked<PruneBackupUseCase>;

  beforeEach(() => {
    pruneBackup = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<PruneBackupUseCase>;

    command = new PruneCommand(pruneBackup);
    process.exitCode = undefined;
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('should call execute for a specific project', async () => {
    pruneBackup.execute.mockResolvedValue([new PruneResult(3, '500 MB')]);

    await command.run(['my-project'], {});

    expect(pruneBackup.execute).toHaveBeenCalledWith(
      expect.objectContaining({ projectName: 'my-project' }),
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('3 snapshot(s)'),
    );
  });

  it('should call execute with isAll when --all is set', async () => {
    pruneBackup.execute.mockResolvedValue([
      new PruneResult(2, '300 MB'),
      new PruneResult(1, '200 MB'),
    ]);

    await command.run([], { all: true });

    expect(pruneBackup.execute).toHaveBeenCalledWith(
      expect.objectContaining({ isAll: true }),
    );
  });

  it('should set exit code 1 when project name missing without --all', async () => {
    await command.run([], {});

    expect(process.exitCode).toBe(1);
  });

  it('should set exit code 1 on error', async () => {
    pruneBackup.execute.mockRejectedValue(new Error('Prune failed'));

    await command.run(['test'], {});

    expect(process.exitCode).toBe(1);
  });
});
