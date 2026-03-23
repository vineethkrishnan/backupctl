import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuditModule } from '@domain/audit/audit.module';
import { NotificationModule } from '@domain/notification/notification.module';
import { RunBackupUseCase } from './application/use-cases/run-backup/run-backup.use-case';
import { RestoreBackupUseCase } from './application/use-cases/restore-backup/restore-backup.use-case';
import { GetRestoreGuideUseCase } from './application/use-cases/get-restore-guide/get-restore-guide.use-case';
import { PruneBackupUseCase } from './application/use-cases/prune-backup/prune-backup.use-case';
import { ListSnapshotsUseCase } from './application/use-cases/list-snapshots/list-snapshots.use-case';
import { GetCacheInfoUseCase } from './application/use-cases/get-cache-info/get-cache-info.use-case';
import { ClearCacheUseCase } from './application/use-cases/clear-cache/clear-cache.use-case';
import { DumperRegistry } from './application/registries/dumper.registry';

import { FileCleanupAdapter } from './infrastructure/adapters/cleanup/file-cleanup.adapter';
import { ShellHookExecutorAdapter } from './infrastructure/adapters/hooks/shell-hook-executor.adapter';
import { GpgEncryptorAdapter } from './infrastructure/adapters/encryptors/gpg-encryptor.adapter';
import { DumperBootstrapService } from './infrastructure/adapters/dumpers/dumper-bootstrap.service';
import { UptimeKumaHeartbeatAdapter } from './infrastructure/adapters/monitors/uptime-kuma-heartbeat.adapter';
import { DynamicSchedulerService } from './infrastructure/scheduler/dynamic-scheduler.service';

import { RunCommand } from './presenters/cli/run.command';
import { RestoreCommand } from './presenters/cli/restore.command';
import { SnapshotsCommand } from './presenters/cli/snapshots.command';
import { PruneCommand } from './presenters/cli/prune.command';
import { CacheCommand } from './presenters/cli/cache.command';
import { ResticCommand } from './presenters/cli/restic.command';
import { UpgradeCommand } from './presenters/cli/upgrade.command';

import {
  DUMPER_REGISTRY,
  DUMP_ENCRYPTOR_PORT,
  LOCAL_CLEANUP_PORT,
  HOOK_EXECUTOR_PORT,
  HEARTBEAT_MONITOR_PORT,
} from '@common/di/injection-tokens';

@Module({
  imports: [ConfigModule, AuditModule, NotificationModule],
  providers: [
    // Use cases
    RunBackupUseCase,
    RestoreBackupUseCase,
    GetRestoreGuideUseCase,
    PruneBackupUseCase,
    ListSnapshotsUseCase,
    GetCacheInfoUseCase,
    ClearCacheUseCase,

    // Registries
    { provide: DUMPER_REGISTRY, useClass: DumperRegistry },

    // Port bindings
    { provide: DUMP_ENCRYPTOR_PORT, useClass: GpgEncryptorAdapter },
    { provide: LOCAL_CLEANUP_PORT, useClass: FileCleanupAdapter },
    { provide: HOOK_EXECUTOR_PORT, useClass: ShellHookExecutorAdapter },
    { provide: HEARTBEAT_MONITOR_PORT, useClass: UptimeKumaHeartbeatAdapter },

    // Infrastructure
    DumperBootstrapService,
    DynamicSchedulerService,

    // CLI commands
    RunCommand,
    RestoreCommand,
    SnapshotsCommand,
    PruneCommand,
    CacheCommand,
    ResticCommand,
    UpgradeCommand,
  ],
  exports: [
    RunBackupUseCase,
    ListSnapshotsUseCase,
    GetCacheInfoUseCase,
    ClearCacheUseCase,
    DUMPER_REGISTRY,
    HEARTBEAT_MONITOR_PORT,
  ],
})
export class BackupModule {}
