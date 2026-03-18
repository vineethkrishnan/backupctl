import { DataSource } from 'typeorm';

import { BackupLogEntity } from './entities/backup-log.entity';

export default new DataSource({
  type: 'postgres',
  host: process.env.AUDIT_DB_HOST || 'localhost',
  port: parseInt(process.env.AUDIT_DB_PORT || '5432', 10),
  database: process.env.AUDIT_DB_NAME || 'backup_audit',
  username: process.env.AUDIT_DB_USER || 'audit_user',
  password: process.env.AUDIT_DB_PASSWORD || 'audit_secret',
  entities: [BackupLogEntity],
  migrations: ['src/infrastructure/persistence/audit/migrations/*.ts'],
});
