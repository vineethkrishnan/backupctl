import { DataSource } from 'typeorm';

import { BackupLogRecord } from './schema/backup-log.record';

export default new DataSource({
  type: 'postgres',
  host: process.env.AUDIT_DB_HOST || 'localhost',
  port: parseInt(process.env.AUDIT_DB_PORT || '5432', 10),
  database: process.env.AUDIT_DB_NAME || 'backup_audit',
  username: process.env.AUDIT_DB_USER || 'audit_user',
  password: process.env.AUDIT_DB_PASSWORD || 'audit_secret',
  entities: [BackupLogRecord],
  migrations: ['src/domain/audit/infrastructure/persistence/typeorm/migrations/*.ts'],
});
