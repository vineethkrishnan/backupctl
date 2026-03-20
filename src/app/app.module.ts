import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSourceOptions } from 'typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';

import { BackupModule } from '@domain/backup/backup.module';
import { AuditModule } from '@domain/audit/audit.module';
import { ConfigAppModule } from '@domain/config/config.module';
import { NotificationModule } from '@domain/notification/notification.module';
import { HealthModule } from '@domain/health/health.module';
import { SharedInfraModule } from './shared-infra.module';
import { typeormConfig } from '../config/typeorm.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [typeormConfig],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const config = configService.get<DataSourceOptions>('typeorm');
        if (!config) {
          throw new Error('TypeORM config is not loaded');
        }
        return config;
      },
    }),
    ScheduleModule.forRoot(),
    WinstonModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const logLevel = configService.get<string>('LOG_LEVEL', 'info');
        return {
          level: logLevel,
          transports: [
            new winston.transports.Console({
              level: logLevel,
              format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.colorize(),
                winston.format.printf(({ timestamp, level, message, ...meta }) => {
                  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
                  return `${String(timestamp)} [${String(level)}] ${String(message)}${metaStr}`;
                }),
              ),
            }),
            new winston.transports.File({
              dirname: configService.get<string>('LOG_DIR', '/data/backups/.logs'),
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
        };
      },
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
