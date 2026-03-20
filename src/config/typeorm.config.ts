import { registerAs } from '@nestjs/config';
import { DataSourceOptions } from 'typeorm';

function getAuditDbPassword(): string {
  const password = process.env.AUDIT_DB_PASSWORD;
  if (!password && process.env.NODE_ENV === 'production') {
    throw new Error('AUDIT_DB_PASSWORD is required in production. Set it in .env or environment.');
  }
  return password ?? 'audit_secret';
}

const baseConfig: DataSourceOptions = {
  type: 'postgres',
  host: process.env.AUDIT_DB_HOST ?? 'localhost',
  port: parseInt(process.env.AUDIT_DB_PORT ?? '5432', 10),
  database: process.env.AUDIT_DB_NAME ?? 'backup_audit',
  username: process.env.AUDIT_DB_USER ?? 'audit_user',
  password: getAuditDbPassword(),
  synchronize: false,
};

const developmentConfig: DataSourceOptions = {
  ...baseConfig,
  entities: [__dirname + '/../domain/**/typeorm/schema/*.record.{js,ts}'],
  migrations: [__dirname + '/../db/migrations/*.{js,ts}'],
  logging: ['error', 'warn', 'migration'],
  migrationsRun: false,
};

const productionConfig: DataSourceOptions = {
  ...baseConfig,
  entities: [__dirname + '/../domain/**/typeorm/schema/*.record.js'],
  migrations: [__dirname + '/../db/migrations/*.js'],
  logging: ['error'],
  migrationsRun: false,
};

export const typeormConfigRaw: DataSourceOptions =
  process.env.NODE_ENV === 'production' ? productionConfig : developmentConfig;

export const typeormConfig = registerAs('typeorm', () => typeormConfigRaw);
