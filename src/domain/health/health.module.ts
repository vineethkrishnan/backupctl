import { Module } from '@nestjs/common';

import { AuditModule } from '@domain/audit/audit.module';
import { BackupModule } from '@domain/backup/backup.module';
import { SystemHealthAdapter } from './infrastructure/adapters/system-health.adapter';
import { CheckHealthUseCase } from './application/use-cases/check-health/check-health.use-case';
import { HealthCommand } from './presenters/cli/health.command';
import { HealthController } from './presenters/http/health.controller';
import { SYSTEM_HEALTH_PORT } from '@common/di/injection-tokens';

@Module({
  imports: [AuditModule, BackupModule],
  controllers: [HealthController],
  providers: [
    CheckHealthUseCase,
    HealthCommand,
    { provide: SYSTEM_HEALTH_PORT, useClass: SystemHealthAdapter },
  ],
  exports: [CheckHealthUseCase],
})
export class HealthModule {}
