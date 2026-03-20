import { DumpResult } from '@domain/backup/domain/value-objects/dump-result.model';
import { MongoDumpAdapter, MongoConfig } from '@domain/backup/infrastructure/adapters/dumpers/mongo-dump.adapter';

jest.mock('@common/helpers/child-process.util');
jest.mock('fs');

import { safeExecFile } from '@common/helpers/child-process.util';
import * as fs from 'fs';

const mockedSafeExecFile = safeExecFile as jest.MockedFunction<typeof safeExecFile>;
const mockedStatSync = fs.statSync as jest.MockedFunction<typeof fs.statSync>;

describe('MongoDumpAdapter', () => {
  const config: MongoConfig = {
    host: 'mongo.example.com',
    port: 27017,
    name: 'appdb',
    user: 'mongouser',
    password: 'mongopass',
  };

  let adapter: MongoDumpAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new MongoDumpAdapter(config);
  });

  describe('dump', () => {
    beforeEach(() => {
      mockedSafeExecFile.mockResolvedValue({ stdout: '', stderr: '' });
      mockedStatSync.mockReturnValue({ size: 4096 } as fs.Stats);
    });

    it('should build correct mongodump args with --config and --archive', async () => {
      await adapter.dump('/backups', 'myproject', '20260318_120000');

      expect(mockedSafeExecFile).toHaveBeenCalledWith(
        'mongodump',
        expect.arrayContaining([
          '--config', '/backups/.mongodump-20260318_120000.conf',
          '--host', 'mongo.example.com',
          '--port', '27017',
          '--db', 'appdb',
          '--username', 'mongouser',
          '--archive=/backups/myproject_backup_20260318_120000.archive.gz',
          '--gzip',
        ]),
      );
    });

    it('should return DumpResult with correct filePath', async () => {
      const result = await adapter.dump('/backups', 'myproject', '20260318_120000');

      expect(result).toBeInstanceOf(DumpResult);
      expect(result.filePath).toBe('/backups/myproject_backup_20260318_120000.archive.gz');
      expect(result.sizeBytes).toBe(4096);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('verify', () => {
    it('should run mongorestore --dryRun with --archive and --gzip', async () => {
      mockedSafeExecFile.mockResolvedValue({ stdout: '', stderr: '' });

      await adapter.verify('/backups/dump.archive.gz');

      expect(mockedSafeExecFile).toHaveBeenCalledWith('mongorestore', [
        '--dryRun',
        '--archive=/backups/dump.archive.gz',
        '--gzip',
      ]);
    });

    it('should return true on success', async () => {
      mockedSafeExecFile.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await adapter.verify('/backups/dump.archive.gz');

      expect(result).toBe(true);
    });

    it('should return false on failure', async () => {
      mockedSafeExecFile.mockRejectedValue(new Error('mongorestore failed'));

      const result = await adapter.verify('/backups/dump.archive.gz');

      expect(result).toBe(false);
    });
  });
});
