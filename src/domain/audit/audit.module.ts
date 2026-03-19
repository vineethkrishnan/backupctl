import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { GetBackupStatusUseCase } from './application/use-cases/get-backup-status/get-backup-status.use-case';
import { GetFailedLogsUseCase } from './application/use-cases/get-failed-logs/get-failed-logs.use-case';
import { RecoverStartupUseCase } from './application/use-cases/recover-startup/recover-startup.use-case';

import { TypeormAuditLogRepository } from './infrastructure/persistence/typeorm/typeorm-audit-log.repository';
import { BackupLogMapper } from './infrastructure/persistence/typeorm/mappers/backup-log.mapper';
import { JsonlFallbackWriterAdapter } from './infrastructure/persistence/fallback/jsonl-fallback-writer.adapter';
import { BackupLogRecord } from './infrastructure/persistence/typeorm/schema/backup-log.record';

import { StatusCommand } from './presenters/cli/status.command';
import { LogsCommand } from './presenters/cli/logs.command';
import { StatusController } from './presenters/http/status.controller';

import { AUDIT_LOG_PORT, FALLBACK_WRITER_PORT } from '@common/di/injection-tokens';

@Module({
  imports: [TypeOrmModule.forFeature([BackupLogRecord])],
  controllers: [StatusController],
  providers: [
    // Use cases
    GetBackupStatusUseCase,
    GetFailedLogsUseCase,
    RecoverStartupUseCase,

    // Mappers
    BackupLogMapper,

    // Port bindings
    { provide: AUDIT_LOG_PORT, useClass: TypeormAuditLogRepository },
    { provide: FALLBACK_WRITER_PORT, useClass: JsonlFallbackWriterAdapter },

    // CLI commands
    StatusCommand,
    LogsCommand,
  ],
  exports: [
    GetBackupStatusUseCase,
    GetFailedLogsUseCase,
    AUDIT_LOG_PORT,
    FALLBACK_WRITER_PORT,
  ],
})
export class AuditModule {}
