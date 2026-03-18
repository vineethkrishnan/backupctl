import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DynamicSchedulerService } from './dynamic-scheduler.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [DynamicSchedulerService],
  exports: [DynamicSchedulerService],
})
export class BackupSchedulerModule {}
