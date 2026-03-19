import { Module } from '@nestjs/common';

import { AuditModule } from '@domain/audit/audit.module';
import { CheckHealthUseCase } from './application/use-cases/check-health/check-health.use-case';
import { HealthCommand } from './presenters/cli/health.command';
import { HealthController } from './presenters/http/health.controller';

@Module({
  imports: [AuditModule],
  controllers: [HealthController],
  providers: [
    CheckHealthUseCase,
    HealthCommand,
  ],
  exports: [CheckHealthUseCase],
})
export class HealthModule {}
