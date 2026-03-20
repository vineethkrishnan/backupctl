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
    this.registry.register('postgres', (config) => {
      const db = config.database;
      if (!db) throw new Error('Database config required for postgres dumper');
      return new PostgresDumpAdapter({
        host: db.host, port: db.port, name: db.name, user: db.user, password: db.password,
      });
    });

    this.registry.register('mysql', (config) => {
      const db = config.database;
      if (!db) throw new Error('Database config required for mysql dumper');
      return new MysqlDumpAdapter({
        host: db.host, port: db.port, name: db.name, user: db.user, password: db.password,
      });
    });

    this.registry.register('mongodb', (config) => {
      const db = config.database;
      if (!db) throw new Error('Database config required for mongodb dumper');
      return new MongoDumpAdapter({
        host: db.host, port: db.port, name: db.name, user: db.user, password: db.password,
      });
    });
  }
}
