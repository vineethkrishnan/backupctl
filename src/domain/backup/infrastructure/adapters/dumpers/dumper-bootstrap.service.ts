import { Inject, Injectable, OnModuleInit } from '@nestjs/common';

import { DumperRegistry } from '@domain/backup/application/registries/dumper.registry';
import { PostgresDumpAdapter } from './postgres-dump.adapter';
import { MysqlDumpAdapter } from './mysql-dump.adapter';
import { MongoDumpAdapter } from './mongo-dump.adapter';
import { DUMPER_REGISTRY } from '@common/di/injection-tokens';

@Injectable()
export class DumperBootstrapService implements OnModuleInit {
  constructor(
    @Inject(DUMPER_REGISTRY) private readonly registry: DumperRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register('postgres', (config) =>
      new PostgresDumpAdapter({
        host: config.database.host,
        port: config.database.port,
        name: config.database.name,
        user: config.database.user,
        password: config.database.password,
      }),
    );

    this.registry.register('mysql', (config) =>
      new MysqlDumpAdapter({
        host: config.database.host,
        port: config.database.port,
        name: config.database.name,
        user: config.database.user,
        password: config.database.password,
      }),
    );

    this.registry.register('mongo', (config) =>
      new MongoDumpAdapter({
        host: config.database.host,
        port: config.database.port,
        name: config.database.name,
        user: config.database.user,
        password: config.database.password,
      }),
    );
  }
}
