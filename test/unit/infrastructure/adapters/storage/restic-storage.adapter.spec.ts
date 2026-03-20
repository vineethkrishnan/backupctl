import { CacheInfo } from '@domain/backup/domain/value-objects/cache-info.model';
import { PruneResult } from '@domain/backup/domain/value-objects/prune-result.model';
import { SnapshotInfo } from '@domain/backup/domain/value-objects/snapshot-info.model';
import { SyncResult } from '@domain/backup/domain/value-objects/sync-result.model';
import { RetentionPolicy } from '@domain/config/domain/retention-policy.model';
import { ResticStorageAdapter } from '@domain/backup/infrastructure/adapters/storage/restic-storage.adapter';

jest.mock('@common/helpers/child-process.util');

import { safeExecFile } from '@common/helpers/child-process.util';

const mockedSafeExecFile = safeExecFile as jest.MockedFunction<typeof safeExecFile>;

describe('ResticStorageAdapter', () => {
  const repositoryPath = '/backups/myproject';
  const password = 'restic-secret';
  const sshHost = 'storage.example.com';
  const sshUser = 'backup';
  const sshKeyPath = '/root/.ssh/id_ed25519';
  const projectName = 'myproject';

  let adapter: ResticStorageAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new ResticStorageAdapter(
      repositoryPath,
      password,
      sshHost,
      sshUser,
      sshKeyPath,
      projectName,
    );
  });

  describe('RESTIC_REPOSITORY', () => {
    it('should build correctly as sftp URL', async () => {
      mockedSafeExecFile.mockResolvedValue({ stdout: '', stderr: '' });

      await adapter.unlock();

      const callArgs = mockedSafeExecFile.mock.calls[0];
      expect(callArgs[2]?.env).toEqual(
        expect.objectContaining({
          RESTIC_REPOSITORY: 'sftp:backup@storage.example.com:/backups/myproject',
        }),
      );
    });
  });

  describe('sync', () => {
    const summaryOutput = JSON.stringify({
      message_type: 'summary',
      snapshot_id: 'abc123def',
      files_new: 10,
      files_changed: 3,
      data_added: 5242880,
      total_duration: 12.5,
    });

    it('should build correct restic backup args with tags', async () => {
      mockedSafeExecFile.mockResolvedValue({ stdout: summaryOutput, stderr: '' });

      await adapter.sync(['/data/dumps', '/data/assets'], {
        tags: ['project:myproject', 'type:backup'],
        snapshotMode: 'combined',
      });

      expect(mockedSafeExecFile).toHaveBeenCalledWith(
        'restic',
        [
          'backup',
          '/data/dumps',
          '/data/assets',
          '--tag',
          'project:myproject',
          '--tag',
          'type:backup',
          '--json',
        ],
        expect.objectContaining({ env: expect.any(Object) }),
      );
    });

    it('should parse JSON output into SyncResult', async () => {
      const statusLine = JSON.stringify({ message_type: 'status', percent_done: 0.5 });
      const multiLineOutput = `${statusLine}\n${summaryOutput}`;
      mockedSafeExecFile.mockResolvedValue({ stdout: multiLineOutput, stderr: '' });

      const result = await adapter.sync(['/data/dumps'], {
        tags: ['backup'],
        snapshotMode: 'combined',
      });

      expect(result).toBeInstanceOf(SyncResult);
      expect(result.snapshotId).toBe('abc123def');
      expect(result.filesNew).toBe(10);
      expect(result.filesChanged).toBe(3);
      expect(result.bytesAdded).toBe(5242880);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should throw if no summary message found', async () => {
      const statusOnly = JSON.stringify({ message_type: 'status', percent_done: 1.0 });
      mockedSafeExecFile.mockResolvedValue({ stdout: statusOnly, stderr: '' });

      await expect(
        adapter.sync(['/data'], { tags: [], snapshotMode: 'combined' }),
      ).rejects.toThrow('No summary message found');
    });
  });

  describe('prune', () => {
    const forgetOutput = JSON.stringify([
      {
        keep: [{ id: 'keep1', short_id: 'k1', time: '', paths: [], hostname: '', tags: null }],
        remove: [
          { id: 'rm1', short_id: 'r1', time: '', paths: [], hostname: '', tags: null },
          { id: 'rm2', short_id: 'r2', time: '', paths: [], hostname: '', tags: null },
        ],
      },
    ]);

    it('should build correct forget --prune args with retention values', async () => {
      mockedSafeExecFile.mockResolvedValue({ stdout: forgetOutput, stderr: '' });
      const retention = new RetentionPolicy(7, 7, 4, 6);

      await adapter.prune(retention);

      expect(mockedSafeExecFile).toHaveBeenCalledWith(
        'restic',
        [
          'forget',
          '--prune',
          '--tag', 'project:myproject',
          '--keep-daily',
          '7',
          '--keep-weekly',
          '4',
          '--keep-monthly',
          '6',
          '--json',
        ],
        expect.objectContaining({ env: expect.any(Object) }),
      );
    });

    it('should omit --keep-monthly when keepMonthly is 0', async () => {
      mockedSafeExecFile.mockResolvedValue({ stdout: forgetOutput, stderr: '' });
      const retention = new RetentionPolicy(7, 7, 4, 0);

      await adapter.prune(retention);

      const args = mockedSafeExecFile.mock.calls[0][1];
      expect(args).not.toContain('--keep-monthly');
    });

    it('should parse output into PruneResult', async () => {
      mockedSafeExecFile.mockResolvedValue({ stdout: forgetOutput, stderr: '' });
      const retention = new RetentionPolicy(7, 7, 4);

      const result = await adapter.prune(retention);

      expect(result).toBeInstanceOf(PruneResult);
      expect(result.snapshotsRemoved).toBe(2);
    });
  });

  describe('listSnapshots', () => {
    const snapshotsOutput = JSON.stringify([
      {
        id: 'snap1',
        short_id: 's1',
        time: '2026-03-18T12:00:00Z',
        paths: ['/data/dumps'],
        hostname: 'backupctl',
        tags: ['project:myproject'],
        size: '5.2 MiB',
      },
      {
        id: 'snap2',
        short_id: 's2',
        time: '2026-03-17T12:00:00Z',
        paths: ['/data/dumps'],
        hostname: 'backupctl',
        tags: null,
        size: '3.1 MiB',
      },
    ]);

    it('should parse JSON output into SnapshotInfo[]', async () => {
      mockedSafeExecFile.mockResolvedValue({ stdout: snapshotsOutput, stderr: '' });

      const result = await adapter.listSnapshots();

      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(SnapshotInfo);
      expect(result[0].id).toBe('snap1');
      expect(result[0].tags).toEqual(['project:myproject']);
      expect(result[1].tags).toEqual([]);
    });
  });

  describe('restore', () => {
    beforeEach(() => {
      mockedSafeExecFile.mockResolvedValue({ stdout: '', stderr: '' });
    });

    it('should build correct restore args', async () => {
      await adapter.restore('snap1', '/restore/target');

      expect(mockedSafeExecFile).toHaveBeenCalledWith(
        'restic',
        ['restore', 'snap1', '--target', '/restore/target'],
        expect.objectContaining({ env: expect.any(Object) }),
      );
    });

    it('should add --include flags when includePaths provided', async () => {
      await adapter.restore('snap1', '/restore/target', ['/data/dumps', '/data/assets']);

      expect(mockedSafeExecFile).toHaveBeenCalledWith(
        'restic',
        [
          'restore',
          'snap1',
          '--target',
          '/restore/target',
          '--include',
          '/data/dumps',
          '--include',
          '/data/assets',
        ],
        expect.objectContaining({ env: expect.any(Object) }),
      );
    });
  });

  describe('exec', () => {
    it('should pass through args with correct env', async () => {
      mockedSafeExecFile.mockResolvedValue({ stdout: 'stats output', stderr: '' });

      const result = await adapter.exec(['stats', '--json']);

      expect(mockedSafeExecFile).toHaveBeenCalledWith(
        'restic',
        ['stats', '--json'],
        expect.objectContaining({
          env: expect.objectContaining({
            RESTIC_REPOSITORY: 'sftp:backup@storage.example.com:/backups/myproject',
            RESTIC_PASSWORD: 'restic-secret',
          }),
        }),
      );
      expect(result).toBe('stats output');
    });
  });

  describe('unlock', () => {
    it('should run restic unlock', async () => {
      mockedSafeExecFile.mockResolvedValue({ stdout: '', stderr: '' });

      await adapter.unlock();

      expect(mockedSafeExecFile).toHaveBeenCalledWith(
        'restic',
        ['unlock'],
        expect.objectContaining({ env: expect.any(Object) }),
      );
    });
  });

  describe('clearCache', () => {
    it('should run restic cache --cleanup', async () => {
      mockedSafeExecFile.mockResolvedValue({ stdout: '', stderr: '' });

      await adapter.clearCache();

      expect(mockedSafeExecFile).toHaveBeenCalledWith(
        'restic',
        ['cache', '--cleanup'],
        expect.objectContaining({ env: expect.any(Object) }),
      );
    });
  });

  describe('getCacheInfo', () => {
    it('should return CacheInfo with project name', async () => {
      const result = await adapter.getCacheInfo();

      expect(result).toBeInstanceOf(CacheInfo);
      expect(result.projectName).toBe('myproject');
      expect(result.cacheSizeBytes).toBeGreaterThanOrEqual(0);
    });
  });
});
