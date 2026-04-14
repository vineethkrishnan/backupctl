import * as fs from 'fs';
import * as path from 'path';

import { DatabaseDumperPort } from '@domain/backup/application/ports/database-dumper.port';
import { DumpResult } from '@domain/backup/domain/value-objects/dump-result.model';
import { safeExecFile } from '@common/helpers/child-process.util';

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

    fs.mkdirSync(outputDir, { recursive: true });

    // Write temporary config to avoid password in process args
    const escapedPassword = this.config.password
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"');
    const configContent = `password: "${escapedPassword}"`;
    const configPath = path.join(outputDir, `.mongodump-${timestamp}.conf`);
    fs.writeFileSync(configPath, configContent, { mode: 0o600 });

    try {
      const args = [
        '--config', configPath,
        '--host', this.config.host,
        '--port', String(this.config.port),
        '--db', this.config.name,
        '--username', this.config.user,
        `--archive=${filePath}`,
        '--gzip',
      ];

      await safeExecFile('mongodump', args);
    } finally {
      try { fs.unlinkSync(configPath); } catch { /* cleanup best-effort */ }
    }

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

  async testConnection(): Promise<void> {
    await safeExecFile('mongosh', [
      '--host', this.config.host,
      '--port', String(this.config.port),
      '--username', this.config.user,
      '--password', this.config.password,
      '--authenticationDatabase', 'admin',
      this.config.name,
      '--eval', 'db.runCommand({ ping: 1 })',
    ], {
      timeout: 10000,
    });
  }
}
