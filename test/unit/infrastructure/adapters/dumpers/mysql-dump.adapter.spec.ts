import { DumpResult } from '@domain/backup/domain/value-objects/dump-result.model';
import { MysqlDumpAdapter, MysqlConfig } from '@domain/backup/infrastructure/adapters/dumpers/mysql-dump.adapter';

jest.mock('@common/helpers/child-process.util');
jest.mock('fs');

import { safeExecFile } from '@common/helpers/child-process.util';
import * as fs from 'fs';

const mockedSafeExecFile = safeExecFile as jest.MockedFunction<typeof safeExecFile>;
const mockedStatSync = fs.statSync as jest.MockedFunction<typeof fs.statSync>;

describe('MysqlDumpAdapter', () => {
  const config: MysqlConfig = {
    host: 'mysql.example.com',
    port: 3306,
    name: 'appdb',
    user: 'root',
    password: 'mysqlpass',
  };

  let adapter: MysqlDumpAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new MysqlDumpAdapter(config);
  });

  describe('dump', () => {
    beforeEach(() => {
      mockedSafeExecFile.mockResolvedValue({ stdout: '', stderr: '' });
      mockedStatSync.mockReturnValue({ size: 2048 } as fs.Stats);
    });

    it('should build correct mysqldump args with MYSQL_PWD env var', async () => {
      await adapter.dump('/backups', 'myproject', '20260318_120000');

      expect(mockedSafeExecFile).toHaveBeenCalledWith(
        'mysqldump',
        [
          '--host',
          'mysql.example.com',
          '--port',
          '3306',
          '--user',
          'root',
          '--single-transaction',
          '--quick',
          '--routines',
          '--result-file',
          '/backups/myproject_backup_20260318_120000.sql',
          'appdb',
        ],
        { env: { MYSQL_PWD: 'mysqlpass' } },
      );
    });

    it('should gzip the output after dump', async () => {
      await adapter.dump('/backups', 'myproject', '20260318_120000');

      expect(mockedSafeExecFile).toHaveBeenCalledTimes(2);
      expect(mockedSafeExecFile).toHaveBeenNthCalledWith(
        1, 'mysqldump', expect.any(Array), expect.objectContaining({ env: { MYSQL_PWD: 'mysqlpass' } }),
      );
      expect(mockedSafeExecFile).toHaveBeenNthCalledWith(2, 'gzip', [
        '/backups/myproject_backup_20260318_120000.sql',
      ]);
    });

    it('should return DumpResult with .sql.gz file path', async () => {
      const result = await adapter.dump('/backups', 'myproject', '20260318_120000');

      expect(result).toBeInstanceOf(DumpResult);
      expect(result.filePath).toBe('/backups/myproject_backup_20260318_120000.sql.gz');
      expect(result.sizeBytes).toBe(2048);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('verify', () => {
    it('should run gunzip --test', async () => {
      mockedSafeExecFile.mockResolvedValue({ stdout: '', stderr: '' });

      await adapter.verify('/backups/dump.sql.gz');

      expect(mockedSafeExecFile).toHaveBeenCalledWith('gunzip', [
        '--test',
        '/backups/dump.sql.gz',
      ]);
    });

    it('should return true on success', async () => {
      mockedSafeExecFile.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await adapter.verify('/backups/dump.sql.gz');

      expect(result).toBe(true);
    });

    it('should return false on failure', async () => {
      mockedSafeExecFile.mockRejectedValue(new Error('gunzip failed'));

      const result = await adapter.verify('/backups/dump.sql.gz');

      expect(result).toBe(false);
    });
  });
});
