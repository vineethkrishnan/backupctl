import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BackupOrchestratorService } from './backup/backup-orchestrator.service';
import { HealthCheckService } from './health/health-check.service';
import { SnapshotManagementService } from './snapshot/snapshot-management.service';
import { AuditQueryService } from './audit/audit-query.service';
import { CacheManagementService } from './backup/cache-management.service';
import { StartupRecoveryService } from './audit/startup-recovery.service';
import { DumperRegistry } from './backup/registries/dumper.registry';
import { NotifierRegistry } from './backup/registries/notifier.registry';
import { DUMPER_REGISTRY, NOTIFIER_REGISTRY } from '@shared/injection-tokens';

@Module({
  imports: [ConfigModule],
  providers: [
    BackupOrchestratorService,
    HealthCheckService,
    SnapshotManagementService,
    AuditQueryService,
    CacheManagementService,
    StartupRecoveryService,
    { provide: DUMPER_REGISTRY, useClass: DumperRegistry },
    { provide: NOTIFIER_REGISTRY, useClass: NotifierRegistry },
  ],
  exports: [
    BackupOrchestratorService,
    HealthCheckService,
    SnapshotManagementService,
    AuditQueryService,
    CacheManagementService,
    StartupRecoveryService,
    DUMPER_REGISTRY,
    NOTIFIER_REGISTRY,
  ],
})
export class ApplicationModule {}
