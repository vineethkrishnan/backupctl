import { SnapshotsCommand } from '@infrastructure/cli/commands/snapshots.command';
import { SnapshotManagementService } from '@application/snapshot/snapshot-management.service';
import { SnapshotInfo } from '@domain/backup/models/snapshot-info.model';

describe('SnapshotsCommand', () => {
  let command: SnapshotsCommand;
  let snapshotManagement: jest.Mocked<SnapshotManagementService>;

  beforeEach(() => {
    snapshotManagement = {
      listSnapshots: jest.fn(),
    } as unknown as jest.Mocked<SnapshotManagementService>;

    command = new SnapshotsCommand(snapshotManagement);
    process.exitCode = undefined;
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('should list snapshots for a project', async () => {
    snapshotManagement.listSnapshots.mockResolvedValue([
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

    expect(snapshotManagement.listSnapshots).toHaveBeenCalledWith('test-project', undefined);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('abc123def4'));
  });

  it('should apply --last limit', async () => {
    snapshotManagement.listSnapshots.mockResolvedValue([]);

    await command.run(['test-project'], { last: 3 });

    expect(snapshotManagement.listSnapshots).toHaveBeenCalledWith('test-project', 3);
  });

  it('should print message when no snapshots found', async () => {
    snapshotManagement.listSnapshots.mockResolvedValue([]);

    await command.run(['test-project'], {});

    expect(console.log).toHaveBeenCalledWith('No snapshots found for test-project.');
  });

  it('should set exit code 1 on error', async () => {
    snapshotManagement.listSnapshots.mockRejectedValue(new Error('Connection failed'));

    await command.run(['test-project'], {});

    expect(process.exitCode).toBe(1);
  });
});
