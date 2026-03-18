import { Module } from '@nestjs/common';

import {
  AUDIT_LOG_PORT,
  BACKUP_LOCK_PORT,
  CLOCK_PORT,
  CONFIG_LOADER_PORT,
  DUMP_ENCRYPTOR_PORT,
  FALLBACK_WRITER_PORT,
  HOOK_EXECUTOR_PORT,
  LOCAL_CLEANUP_PORT,
  REMOTE_STORAGE_FACTORY,
} from '@shared/injection-tokens';

import { SystemClockAdapter } from './adapters/clock/system-clock.adapter';
import { YamlConfigLoaderAdapter } from './adapters/config/yaml-config-loader.adapter';
import { FileCleanupAdapter } from './adapters/cleanup/file-cleanup.adapter';
import { ShellHookExecutorAdapter } from './adapters/hooks/shell-hook-executor.adapter';
import { GpgEncryptorAdapter } from './adapters/encryptors/gpg-encryptor.adapter';
import { GpgKeyManager } from './adapters/encryptors/gpg-key-manager';
import { ResticStorageFactory } from './adapters/storage/restic-storage.factory';
import { TypeormAuditLogAdapter } from './persistence/audit/typeorm-audit-log.adapter';
import { JsonlFallbackWriterAdapter } from './persistence/fallback/jsonl-fallback-writer.adapter';
import { FileBackupLockAdapter } from './persistence/lock/file-backup-lock.adapter';
import { HttpModule } from './http/http.module';
import { BackupSchedulerModule } from './scheduler/scheduler.module';

const portBindings = [
  { provide: CLOCK_PORT, useClass: SystemClockAdapter },
  { provide: CONFIG_LOADER_PORT, useClass: YamlConfigLoaderAdapter },
  { provide: LOCAL_CLEANUP_PORT, useClass: FileCleanupAdapter },
  { provide: HOOK_EXECUTOR_PORT, useClass: ShellHookExecutorAdapter },
  { provide: DUMP_ENCRYPTOR_PORT, useClass: GpgEncryptorAdapter },
  { provide: AUDIT_LOG_PORT, useClass: TypeormAuditLogAdapter },
  { provide: FALLBACK_WRITER_PORT, useClass: JsonlFallbackWriterAdapter },
  { provide: BACKUP_LOCK_PORT, useClass: FileBackupLockAdapter },
  { provide: REMOTE_STORAGE_FACTORY, useClass: ResticStorageFactory },
];

@Module({
  imports: [HttpModule, BackupSchedulerModule],
  providers: [...portBindings, GpgKeyManager, ResticStorageFactory],
  exports: [
    ...portBindings.map((binding) => binding.provide),
    GpgKeyManager,
    ResticStorageFactory,
    BackupSchedulerModule,
  ],
})
export class InfrastructureModule {}
