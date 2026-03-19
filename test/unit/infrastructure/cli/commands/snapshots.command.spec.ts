import { SnapshotsCommand } from '@domain/backup/presenters/cli/snapshots.command';
import { ListSnapshotsUseCase } from '@domain/backup/application/use-cases/list-snapshots/list-snapshots.use-case';
import { SnapshotInfo } from '@domain/backup/domain/value-objects/snapshot-info.model';

describe('SnapshotsCommand', () => {
  let command: SnapshotsCommand;
  let listSnapshotsUseCase: jest.Mocked<ListSnapshotsUseCase>;

  beforeEach(() => {
    listSnapshotsUseCase = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<ListSnapshotsUseCase>;

    command = new SnapshotsCommand(listSnapshotsUseCase);
    process.exitCode = undefined;
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('should list snapshots for a project', async () => {
    listSnapshotsUseCase.execute.mockResolvedValue([
      new SnapshotInfo(
        'abc123def456',
        '2026-03-18T10:00:00Z',
        ['/data/backups/test'],
        'backupctl',
        ['project:test', 'db:postgres'],
        '150 MB',
      ),
    ]);

    await command.run(['test-project'], {});

    expect(listSnapshotsUseCase.execute).toHaveBeenCalledWith(
      expect.objectContaining({ projectName: 'test-project', limit: undefined }),
    );
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('abc123def4'));
  });

  it('should apply --last limit', async () => {
    listSnapshotsUseCase.execute.mockResolvedValue([]);

    await command.run(['test-project'], { last: 3 });

    expect(listSnapshotsUseCase.execute).toHaveBeenCalledWith(
      expect.objectContaining({ projectName: 'test-project', limit: 3 }),
    );
  });

  it('should print message when no snapshots found', async () => {
    listSnapshotsUseCase.execute.mockResolvedValue([]);

    await command.run(['test-project'], {});

    expect(console.log).toHaveBeenCalledWith('No snapshots found for test-project.');
  });

  it('should set exit code 1 on error', async () => {
    listSnapshotsUseCase.execute.mockRejectedValue(new Error('Connection failed'));

    await command.run(['test-project'], {});

    expect(process.exitCode).toBe(1);
  });
});
