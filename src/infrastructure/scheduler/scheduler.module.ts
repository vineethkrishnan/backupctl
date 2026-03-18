import { Module } from '@nestjs/common';
import { DynamicSchedulerService } from './dynamic-scheduler.service';

@Module({
  providers: [DynamicSchedulerService],
  exports: [DynamicSchedulerService],
})
export class BackupSchedulerModule {}
