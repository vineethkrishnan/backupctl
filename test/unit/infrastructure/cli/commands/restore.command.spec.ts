import { RestoreCommand } from '@domain/backup/presenters/cli/restore.command';
import { RestoreBackupUseCase } from '@domain/backup/application/use-cases/restore-backup/restore-backup.use-case';
import { GetRestoreGuideUseCase } from '@domain/backup/application/use-cases/get-restore-guide/get-restore-guide.use-case';

describe('RestoreCommand', () => {
  let command: RestoreCommand;
  let mockRestoreBackup: jest.Mocked<RestoreBackupUseCase>;
  let mockGetRestoreGuide: jest.Mocked<GetRestoreGuideUseCase>;

  beforeEach(() => {
    mockRestoreBackup = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<RestoreBackupUseCase>;
    mockGetRestoreGuide = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<GetRestoreGuideUseCase>;

    command = new RestoreCommand(mockRestoreBackup, mockGetRestoreGuide);
    process.exitCode = undefined;
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('should call restoreBackup execute with correct arguments', async () => {
    mockRestoreBackup.execute.mockResolvedValue();

    await command.run(['my-project', 'snap-abc', '/restore/path'], {});

    expect(mockRestoreBackup.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        projectName: 'my-project',
        snapshotId: 'snap-abc',
        targetPath: '/restore/path',
        decompress: false,
      }),
    );
  });

  it('should pass --only option to restoreBackup', async () => {
    mockRestoreBackup.execute.mockResolvedValue();

    await command.run(['my-project', 'snap-abc', '/restore/path'], { only: 'db' });

    expect(mockRestoreBackup.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        projectName: 'my-project',
        snapshotId: 'snap-abc',
        targetPath: '/restore/path',
        only: 'db',
        decompress: false,
      }),
    );
  });

  it('should pass --decompress option', async () => {
    mockRestoreBackup.execute.mockResolvedValue();

    await command.run(['my-project', 'snap-abc', '/restore/path'], { decompress: true });

    expect(mockRestoreBackup.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        projectName: 'my-project',
        snapshotId: 'snap-abc',
        targetPath: '/restore/path',
        decompress: true,
      }),
    );
  });

  it('should print restore guide when --guide is set', async () => {
    mockGetRestoreGuide.execute.mockReturnValue('Step 1: pg_restore...');

    await command.run(['my-project', 'snap-abc', '/restore/path'], { guide: true });

    expect(mockGetRestoreGuide.execute).toHaveBeenCalledWith(
      expect.objectContaining({ projectName: 'my-project' }),
    );
    expect(mockRestoreBackup.execute).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith('Step 1: pg_restore...');
  });

  it('should set exit code 1 on error', async () => {
    mockRestoreBackup.execute.mockRejectedValue(new Error('Snapshot not found'));

    await command.run(['my-project', 'snap-abc', '/restore/path'], {});

    expect(process.exitCode).toBe(1);
  });
});
