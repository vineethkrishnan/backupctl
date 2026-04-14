import * as fs from 'fs';
import * as path from 'path';

import { DatabaseDumperPort, DumpOptions } from '@domain/backup/application/ports/database-dumper.port';
import { DumpResult } from '@domain/backup/domain/value-objects/dump-result.model';
import { safeExecFile } from '@common/helpers/child-process.util';

export interface PostgresConfig {
  readonly host: string;
  readonly port: number;
  readonly name: string;
  readonly user: string;
  readonly password: string;
}

export class PostgresDumpAdapter implements DatabaseDumperPort {
  constructor(private readonly config: PostgresConfig) {}

  async dump(outputDir: string, projectName: string, timestamp: string, options?: DumpOptions): Promise<DumpResult> {
    const fileName = `${projectName}_backup_${timestamp}.dump`;
    const filePath = path.join(outputDir, fileName);
    const startTime = Date.now();

    fs.mkdirSync(outputDir, { recursive: true });

    const args = [
      '--host', this.config.host,
      '--port', String(this.config.port),
      '--username', this.config.user,
      '--dbname', this.config.name,
      '--format=custom',
      '--file', filePath,
    ];

    await safeExecFile('pg_dump', args, {
      env: { PGPASSWORD: this.config.password },
      timeout: options?.timeoutMs,
    });

    const stats = fs.statSync(filePath);
    const durationMs = Date.now() - startTime;

    return new DumpResult(filePath, stats.size, durationMs);
  }

  async verify(filePath: string): Promise<boolean> {
    try {
      await safeExecFile('pg_restore', ['--list', filePath]);
      return true;
    } catch {
      return false;
    }
  }

  async testConnection(): Promise<void> {
    await safeExecFile('psql', [
      '--host', this.config.host,
      '--port', String(this.config.port),
      '--username', this.config.user,
      '--dbname', this.config.name,
      '--command', 'SELECT 1',
    ], {
      env: { PGPASSWORD: this.config.password },
      timeout: 10000,
    });
  }
}
