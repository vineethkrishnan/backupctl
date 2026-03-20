import { Global, Module } from '@nestjs/common';

import { SystemClockAdapter } from '@common/clock/system-clock.adapter';
import { LocalFilesystemAdapter } from '@common/filesystem/local-filesystem.adapter';
import { EnvValidationService } from '@common/validation/env-validation.service';
import { FileBackupLockAdapter } from '@domain/backup/infrastructure/adapters/lock/file-backup-lock.adapter';
import { ResticStorageFactory } from '@domain/backup/infrastructure/adapters/storage/restic-storage.factory';
import { GpgKeyManagerAdapter } from '@domain/backup/infrastructure/adapters/encryptors/gpg-key-manager.adapter';

import {
  BACKUP_LOCK_PORT,
  CLOCK_PORT,
  FILESYSTEM_PORT,
  GPG_KEY_MANAGER_PORT,
  REMOTE_STORAGE_FACTORY,
} from '@common/di/injection-tokens';

@Global()
@Module({
  providers: [
    EnvValidationService,
    { provide: CLOCK_PORT, useClass: SystemClockAdapter },
    { provide: FILESYSTEM_PORT, useClass: LocalFilesystemAdapter },
    { provide: BACKUP_LOCK_PORT, useClass: FileBackupLockAdapter },
    { provide: REMOTE_STORAGE_FACTORY, useClass: ResticStorageFactory },
    { provide: GPG_KEY_MANAGER_PORT, useClass: GpgKeyManagerAdapter },
  ],
  exports: [
    CLOCK_PORT,
    FILESYSTEM_PORT,
    BACKUP_LOCK_PORT,
    REMOTE_STORAGE_FACTORY,
    GPG_KEY_MANAGER_PORT,
  ],
})
export class SharedInfraModule {}
