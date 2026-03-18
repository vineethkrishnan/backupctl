import { RestoreCommand } from '@infrastructure/cli/commands/restore.command';
import { BackupOrchestratorService } from '@application/backup/backup-orchestrator.service';

describe('RestoreCommand', () => {
  let command: RestoreCommand;
  let orchestrator: jest.Mocked<BackupOrchestratorService>;

  beforeEach(() => {
    orchestrator = {
      restoreBackup: jest.fn(),
      getRestoreGuide: jest.fn(),
    } as unknown as jest.Mocked<BackupOrchestratorService>;

    command = new RestoreCommand(orchestrator);
    process.exitCode = undefined;
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('should call restoreBackup with correct arguments', async () => {
    orchestrator.restoreBackup.mockResolvedValue();

    await command.run(['my-project', 'snap-abc', '/restore/path'], {});

    expect(orchestrator.restoreBackup).toHaveBeenCalledWith(
      'my-project',
      'snap-abc',
      '/restore/path',
      { only: undefined, decompress: undefined },
    );
  });

  it('should pass --only option to restoreBackup', async () => {
    orchestrator.restoreBackup.mockResolvedValue();

    await command.run(['my-project', 'snap-abc', '/restore/path'], { only: 'db' });

    expect(orchestrator.restoreBackup).toHaveBeenCalledWith(
      'my-project',
      'snap-abc',
      '/restore/path',
      { only: 'db', decompress: undefined },
    );
  });

  it('should pass --decompress option', async () => {
    orchestrator.restoreBackup.mockResolvedValue();

    await command.run(['my-project', 'snap-abc', '/restore/path'], { decompress: true });

    expect(orchestrator.restoreBackup).toHaveBeenCalledWith(
      'my-project',
      'snap-abc',
      '/restore/path',
      { only: undefined, decompress: true },
    );
  });

  it('should print restore guide when --guide is set', async () => {
    orchestrator.getRestoreGuide.mockReturnValue('Step 1: pg_restore...');

    await command.run(['my-project', 'snap-abc', '/restore/path'], { guide: true });

    expect(orchestrator.getRestoreGuide).toHaveBeenCalledWith('my-project');
    expect(orchestrator.restoreBackup).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith('Step 1: pg_restore...');
  });

  it('should set exit code 1 on error', async () => {
    orchestrator.restoreBackup.mockRejectedValue(new Error('Snapshot not found'));

    await command.run(['my-project', 'snap-abc', '/restore/path'], {});

    expect(process.exitCode).toBe(1);
  });
});
