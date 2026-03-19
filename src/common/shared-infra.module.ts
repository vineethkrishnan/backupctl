import { Global, Module } from '@nestjs/common';

import { SystemClockAdapter } from './clock/system-clock.adapter';
import { FileBackupLockAdapter } from '@domain/backup/infrastructure/adapters/lock/file-backup-lock.adapter';
import { ResticStorageFactory } from '@domain/backup/infrastructure/adapters/storage/restic-storage.factory';

import { BACKUP_LOCK_PORT, CLOCK_PORT, REMOTE_STORAGE_FACTORY } from './di/injection-tokens';

@Global()
@Module({
  providers: [
    { provide: CLOCK_PORT, useClass: SystemClockAdapter },
    { provide: BACKUP_LOCK_PORT, useClass: FileBackupLockAdapter },
    { provide: REMOTE_STORAGE_FACTORY, useClass: ResticStorageFactory },
    ResticStorageFactory,
  ],
  exports: [CLOCK_PORT, BACKUP_LOCK_PORT, REMOTE_STORAGE_FACTORY, ResticStorageFactory],
})
export class SharedInfraModule {}
