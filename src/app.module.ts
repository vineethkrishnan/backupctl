import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { ApplicationModule } from '@application/application.module';
import { InfrastructureModule } from '@infrastructure/infrastructure.module';
import { BackupLogEntity } from '@infrastructure/persistence/audit/entities/backup-log.entity';

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
        entities: [BackupLogEntity],
        synchronize: false,
        migrationsRun: true,
        migrations: ['dist/infrastructure/persistence/audit/migrations/*.js'],
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
          new DailyRotateFile({
            dirname: configService.get('LOG_DIR', '/data/backups/.logs'),
            filename: 'backupctl-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            maxSize: configService.get('LOG_MAX_SIZE', '10m'),
            maxFiles: configService.get('LOG_MAX_FILES', '5'),
            format: winston.format.combine(
              winston.format.timestamp(),
              winston.format.json(),
            ),
          }),
        ],
      }),
    }),
    InfrastructureModule,
    ApplicationModule,
  ],
})
export class AppModule {}
