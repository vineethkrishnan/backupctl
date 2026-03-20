import { Inject, Injectable } from '@nestjs/common';
import { ConfigLoaderPort } from '@domain/config/application/ports/config-loader.port';
import { CONFIG_LOADER_PORT } from '@common/di/injection-tokens';
import { GetRestoreGuideQuery } from './get-restore-guide.query';

@Injectable()
export class GetRestoreGuideUseCase {
  constructor(
    @Inject(CONFIG_LOADER_PORT) private readonly configLoader: ConfigLoaderPort,
  ) {}

  execute(query: GetRestoreGuideQuery): string {
    const config = this.configLoader.getProject(query.projectName);

    if (!config.hasDatabase()) {
      return 'This project has no database configured — restore guide is only available for database backups.';
    }

    const db = config.database!;
    const dbType = db.type.toLowerCase();

    const guides: Record<string, string> = {
      postgres: [
        `Restore steps for PostgreSQL (database: ${db.name}):`,
        '1. pg_restore -h <HOST> -p <PORT> -U <USER> -d <DBNAME> <dump_file>',
        '2. If compressed: gunzip the file first, then run pg_restore',
        '3. If encrypted: gpg --decrypt <file>.gpg > <file> first',
        '',
        'Tip: Connection details are in your projects.yml config.',
      ].join('\n'),
      mysql: [
        `Restore steps for MySQL (database: ${db.name}):`,
        '1. mysql -h <HOST> -P <PORT> -u <USER> -p <DBNAME> < <dump_file>',
        '2. If compressed: gunzip the file first, then import',
        '3. If encrypted: gpg --decrypt <file>.gpg > <file> first',
        '',
        'Tip: Connection details are in your projects.yml config.',
      ].join('\n'),
      mongodb: [
        `Restore steps for MongoDB (database: ${db.name}):`,
        '1. mongorestore --host <HOST> --port <PORT> -u <USER> -d <DBNAME> <dump_directory>',
        '2. If compressed: the archive will be auto-decompressed by mongorestore',
        '3. If encrypted: gpg --decrypt <file>.gpg > <file> first',
        '',
        'Tip: Connection details are in your projects.yml config.',
      ].join('\n'),
    };

    return guides[dbType] ?? `No restore guide available for database type: ${dbType}`;
  }
}
