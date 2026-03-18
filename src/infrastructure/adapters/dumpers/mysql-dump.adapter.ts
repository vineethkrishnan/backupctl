import * as fs from 'fs';
import * as path from 'path';

import { DatabaseDumperPort } from '@domain/backup/ports/database-dumper.port';
import { DumpResult } from '@domain/backup/models/dump-result.model';
import { safeExecFile } from '@shared/child-process.util';

export interface MysqlConfig {
  readonly host: string;
  readonly port: number;
  readonly name: string;
  readonly user: string;
  readonly password: string;
}

export class MysqlDumpAdapter implements DatabaseDumperPort {
  constructor(private readonly config: MysqlConfig) {}

  async dump(outputDir: string, projectName: string, timestamp: string): Promise<DumpResult> {
    const baseName = `${projectName}_backup_${timestamp}.sql`;
    const sqlFilePath = path.join(outputDir, baseName);
    const gzFilePath = `${sqlFilePath}.gz`;
    const startTime = Date.now();

    // Dump to file first
    const args = [
      '--host',
      this.config.host,
      '--port',
      String(this.config.port),
      '--user',
      this.config.user,
      `--password=${this.config.password}`,
      '--single-transaction',
      '--quick',
      '--routines',
      '--result-file',
      sqlFilePath,
      this.config.name,
    ];

    await safeExecFile('mysqldump', args);

    // Compress with gzip (replaces original file with .gz)
    await safeExecFile('gzip', [sqlFilePath]);

    const stats = fs.statSync(gzFilePath);
    const durationMs = Date.now() - startTime;

    return new DumpResult(gzFilePath, stats.size, durationMs);
  }

  async verify(filePath: string): Promise<boolean> {
    try {
      await safeExecFile('gunzip', ['--test', filePath]);
      return true;
    } catch {
      return false;
    }
  }
}
