import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';

import { BackupModule } from '@domain/backup/backup.module';
import { AuditModule } from '@domain/audit/audit.module';
import { ConfigAppModule } from '@domain/config/config.module';
import { NotificationModule } from '@domain/notification/notification.module';
import { HealthModule } from '@domain/health/health.module';
import { SharedInfraModule } from '@common/shared-infra.module';
import { BackupLogRecord } from '@domain/audit/infrastructure/persistence/typeorm/schema/backup-log.record';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres' as const,
        host: configService.get<string>('AUDIT_DB_HOST', 'localhost'),
        port: configService.get<number>('AUDIT_DB_PORT', 5432),
        database: configService.get<string>('AUDIT_DB_NAME', 'backup_audit'),
        username: configService.get<string>('AUDIT_DB_USER', 'audit_user'),
        password: configService.get<string>('AUDIT_DB_PASSWORD', 'audit_secret'),
        entities: [BackupLogRecord],
        synchronize: false,
        migrationsRun: true,
        migrations: ['dist/domain/audit/infrastructure/persistence/typeorm/migrations/*.js'],
      }),
    }),
    ScheduleModule.forRoot(),
    WinstonModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        transports: [
          new winston.transports.Console({
            format: winston.format.combine(
              winston.format.timestamp(),
              winston.format.colorize(),
              winston.format.printf(({ timestamp, level, message, ...meta }) => {
                const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
                return `${timestamp} [${level}] ${message}${metaStr}`;
              }),
            ),
          }),
          new winston.transports.File({
            dirname: configService.get('LOG_DIR', '/data/backups/.logs'),
            filename: 'backupctl.log',
            maxsize: 10 * 1024 * 1024, // 10 MB
            maxFiles: 5,
            tailable: true,
            format: winston.format.combine(
              winston.format.timestamp(),
              winston.format.json(),
            ),
          }),
        ],
      }),
    }),
    SharedInfraModule,
    ConfigAppModule,
    AuditModule,
    BackupModule,
    NotificationModule,
    HealthModule,
  ],
})
export class AppModule {}
