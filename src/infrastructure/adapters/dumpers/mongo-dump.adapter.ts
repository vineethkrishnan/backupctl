import * as fs from 'fs';
import * as path from 'path';

import { DatabaseDumperPort } from '@domain/backup/ports/database-dumper.port';
import { DumpResult } from '@domain/backup/models/dump-result.model';
import { safeExecFile } from '@shared/child-process.util';

export interface MongoConfig {
  readonly host: string;
  readonly port: number;
  readonly name: string;
  readonly user: string;
  readonly password: string;
}

export class MongoDumpAdapter implements DatabaseDumperPort {
  constructor(private readonly config: MongoConfig) {}

  async dump(outputDir: string, projectName: string, timestamp: string): Promise<DumpResult> {
    const fileName = `${projectName}_backup_${timestamp}.archive.gz`;
    const filePath = path.join(outputDir, fileName);
    const startTime = Date.now();

    const args = [
      '--host',
      this.config.host,
      '--port',
      String(this.config.port),
      '--db',
      this.config.name,
      '--username',
      this.config.user,
      '--password',
      this.config.password,
      `--archive=${filePath}`,
      '--gzip',
    ];

    await safeExecFile('mongodump', args);

    const stats = fs.statSync(filePath);
    const durationMs = Date.now() - startTime;

    return new DumpResult(filePath, stats.size, durationMs);
  }

  async verify(filePath: string): Promise<boolean> {
    try {
      await safeExecFile('mongorestore', [
        '--dryRun',
        `--archive=${filePath}`,
        '--gzip',
      ]);
      return true;
    } catch {
      return false;
    }
  }
}
