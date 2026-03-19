import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuditModule } from '@domain/audit/audit.module';
import { RunBackupUseCase } from './application/use-cases/run-backup/run-backup.use-case';
import { RestoreBackupUseCase } from './application/use-cases/restore-backup/restore-backup.use-case';
import { GetRestoreGuideUseCase } from './application/use-cases/get-restore-guide/get-restore-guide.use-case';
import { PruneBackupUseCase } from './application/use-cases/prune-backup/prune-backup.use-case';
import { ListSnapshotsUseCase } from './application/use-cases/list-snapshots/list-snapshots.use-case';
import { GetCacheInfoUseCase } from './application/use-cases/get-cache-info/get-cache-info.use-case';
import { ClearCacheUseCase } from './application/use-cases/clear-cache/clear-cache.use-case';
import { DumperRegistry } from './application/registries/dumper.registry';
import { NotifierRegistry } from './application/registries/notifier.registry';

import { GpgKeyManager } from './infrastructure/adapters/encryptors/gpg-key-manager';
import { FileCleanupAdapter } from './infrastructure/adapters/cleanup/file-cleanup.adapter';
import { ShellHookExecutorAdapter } from './infrastructure/adapters/hooks/shell-hook-executor.adapter';
import { GpgEncryptorAdapter } from './infrastructure/adapters/encryptors/gpg-encryptor.adapter';
import { DynamicSchedulerService } from './infrastructure/scheduler/dynamic-scheduler.service';

import { RunCommand } from './presenters/cli/run.command';
import { RestoreCommand } from './presenters/cli/restore.command';
import { SnapshotsCommand } from './presenters/cli/snapshots.command';
import { PruneCommand } from './presenters/cli/prune.command';
import { CacheCommand } from './presenters/cli/cache.command';
import { ResticCommand } from './presenters/cli/restic.command';

import {
  DUMPER_REGISTRY,
  NOTIFIER_REGISTRY,
  DUMP_ENCRYPTOR_PORT,
  LOCAL_CLEANUP_PORT,
  HOOK_EXECUTOR_PORT,
} from '@common/di/injection-tokens';

@Module({
  imports: [ConfigModule, AuditModule],
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
    { provide: NOTIFIER_REGISTRY, useClass: NotifierRegistry },

    // Port bindings
    { provide: DUMP_ENCRYPTOR_PORT, useClass: GpgEncryptorAdapter },
    { provide: LOCAL_CLEANUP_PORT, useClass: FileCleanupAdapter },
    { provide: HOOK_EXECUTOR_PORT, useClass: ShellHookExecutorAdapter },

    // Infrastructure
    GpgKeyManager,
    DynamicSchedulerService,

    // CLI commands
    RunCommand,
    RestoreCommand,
    SnapshotsCommand,
    PruneCommand,
    CacheCommand,
    ResticCommand,
  ],
  exports: [
    RunBackupUseCase,
    ListSnapshotsUseCase,
    GetCacheInfoUseCase,
    ClearCacheUseCase,
    DUMPER_REGISTRY,
    NOTIFIER_REGISTRY,
    GpgKeyManager,
  ],
})
export class BackupModule {}
