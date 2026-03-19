import { DumpResult } from '@domain/backup/domain/value-objects/dump-result.model';
import { PostgresDumpAdapter, PostgresConfig } from '@domain/backup/infrastructure/adapters/dumpers/postgres-dump.adapter';

jest.mock('@common/helpers/child-process.util');
jest.mock('fs');

import { safeExecFile } from '@common/helpers/child-process.util';
import * as fs from 'fs';

const mockedSafeExecFile = safeExecFile as jest.MockedFunction<typeof safeExecFile>;
const mockedStatSync = fs.statSync as jest.MockedFunction<typeof fs.statSync>;

describe('PostgresDumpAdapter', () => {
  const config: PostgresConfig = {
    host: 'db.example.com',
    port: 5432,
    name: 'mydb',
    user: 'admin',
    password: 's3cret',
  };

  let adapter: PostgresDumpAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new PostgresDumpAdapter(config);
  });

  describe('dump', () => {
    beforeEach(() => {
      mockedSafeExecFile.mockResolvedValue({ stdout: '', stderr: '' });
      mockedStatSync.mockReturnValue({ size: 1024 } as fs.Stats);
    });

    it('should build correct pg_dump args', async () => {
      await adapter.dump('/backups', 'myproject', '20260318_120000');

      expect(mockedSafeExecFile).toHaveBeenCalledWith(
        'pg_dump',
        [
          '--host',
          'db.example.com',
          '--port',
          '5432',
          '--username',
          'admin',
          '--dbname',
          'mydb',
          '--format=custom',
          '--file',
          '/backups/myproject_backup_20260318_120000.dump',
        ],
        expect.objectContaining({
          env: expect.objectContaining({ PGPASSWORD: 's3cret' }),
        }),
      );
    });

    it('should set PGPASSWORD env var', async () => {
      await adapter.dump('/backups', 'myproject', '20260318_120000');

      const callArgs = mockedSafeExecFile.mock.calls[0];
      expect(callArgs[2]?.env).toEqual({ PGPASSWORD: 's3cret' });
    });

    it('should return DumpResult with correct filePath and sizeBytes', async () => {
      const result = await adapter.dump('/backups', 'myproject', '20260318_120000');

      expect(result).toBeInstanceOf(DumpResult);
      expect(result.filePath).toBe('/backups/myproject_backup_20260318_120000.dump');
      expect(result.sizeBytes).toBe(1024);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should get file size using fs.statSync', async () => {
      await adapter.dump('/backups', 'myproject', '20260318_120000');

      expect(mockedStatSync).toHaveBeenCalledWith(
        '/backups/myproject_backup_20260318_120000.dump',
      );
    });
  });

  describe('verify', () => {
    it('should run pg_restore --list', async () => {
      mockedSafeExecFile.mockResolvedValue({ stdout: 'table list output', stderr: '' });

      await adapter.verify('/backups/myproject_backup_20260318_120000.dump');

      expect(mockedSafeExecFile).toHaveBeenCalledWith('pg_restore', [
        '--list',
        '/backups/myproject_backup_20260318_120000.dump',
      ]);
    });

    it('should return true on success', async () => {
      mockedSafeExecFile.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await adapter.verify('/backups/dump.dump');

      expect(result).toBe(true);
    });

    it('should return false on failure', async () => {
      mockedSafeExecFile.mockRejectedValue(new Error('pg_restore failed'));

      const result = await adapter.verify('/backups/dump.dump');

      expect(result).toBe(false);
    });
  });
});
