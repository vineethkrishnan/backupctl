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
    const dbType = config.database.type.toLowerCase();

    const guides: Record<string, string> = {
      postgres: [
        'Restore steps for PostgreSQL:',
        `1. pg_restore -h ${config.database.host} -p ${config.database.port} -U ${config.database.user} -d ${config.database.name} <dump_file>`,
        '2. If compressed: gunzip the file first, then run pg_restore',
        '3. If encrypted: gpg --decrypt <file>.gpg > <file> first',
      ].join('\n'),
      mysql: [
        'Restore steps for MySQL:',
        `1. mysql -h ${config.database.host} -P ${config.database.port} -u ${config.database.user} -p ${config.database.name} < <dump_file>`,
        '2. If compressed: gunzip the file first, then import',
        '3. If encrypted: gpg --decrypt <file>.gpg > <file> first',
      ].join('\n'),
      mongodb: [
        'Restore steps for MongoDB:',
        `1. mongorestore --host ${config.database.host} --port ${config.database.port} -u ${config.database.user} -d ${config.database.name} <dump_directory>`,
        '2. If compressed: the archive will be auto-decompressed by mongorestore',
        '3. If encrypted: gpg --decrypt <file>.gpg > <file> first',
      ].join('\n'),
    };

    return guides[dbType] ?? `No restore guide available for database type: ${dbType}`;
  }
}
