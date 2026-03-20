import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import { BackupLockPort } from '@domain/backup/application/ports/backup-lock.port';
import { ConfigLoaderPort } from '@domain/config/application/ports/config-loader.port';
import { RunBackupUseCase } from '@domain/backup/application/use-cases/run-backup/run-backup.use-case';
import { RunBackupCommand } from '@domain/backup/application/use-cases/run-backup/run-backup.command';
import { NotifierRegistry } from '@domain/notification/application/registries/notifier.registry';
import { GetBackupStatusUseCase } from '@domain/audit/application/use-cases/get-backup-status/get-backup-status.use-case';
import { GetBackupStatusQuery } from '@domain/audit/application/use-cases/get-backup-status/get-backup-status.query';
import {
  BACKUP_LOCK_PORT,
  CONFIG_LOADER_PORT,
  NOTIFIER_REGISTRY,
} from '@common/di/injection-tokens';

@Injectable()
export class DynamicSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DynamicSchedulerService.name);
  private readonly dailySummaryCron: string;

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    @Inject(CONFIG_LOADER_PORT) private readonly configLoader: ConfigLoaderPort,
    private readonly runBackupUseCase: RunBackupUseCase,
    @Inject(BACKUP_LOCK_PORT) private readonly backupLock: BackupLockPort,
    @Inject(NOTIFIER_REGISTRY) private readonly notifierRegistry: NotifierRegistry,
    private readonly getBackupStatus: GetBackupStatusUseCase,
    configService: ConfigService,
  ) {
    this.dailySummaryCron = configService.get<string>('DAILY_SUMMARY_CRON', '0 7 * * *');
    this.isCliMode = configService.get<string>('BACKUPCTL_CLI_MODE') === '1';
  }

  private readonly isCliMode: boolean;
  private shutdownInProgress = false;

  onModuleInit(): Promise<void> {
    if (this.isCliMode) {
      return Promise.resolve();
    }

    this.registerBackupJobs();
    this.registerDailySummaryJob();
    return Promise.resolve();
  }

  onModuleDestroy(): void {
    this.shutdownInProgress = true;
    this.clearAllJobs();
    this.logger.log('Scheduler shut down — all cron jobs stopped');
  }

  reRegisterJobs(): void {
    this.clearAllJobs();
    this.registerBackupJobs();
    this.registerDailySummaryJob();
    this.logger.log('All cron jobs re-registered after config reload');
  }

  // Extracted for testability — called by cron callback
  async executeScheduledBackup(projectName: string): Promise<void> {
    if (this.shutdownInProgress) {
      this.logger.warn(`Skipping scheduled backup for ${projectName} — shutdown in progress`);
      return;
    }
    this.logger.log(`Scheduled backup triggered for ${projectName}`);
    await this.backupLock.acquireOrQueue(projectName);
    try {
      await this.runBackupUseCase.execute(
        new RunBackupCommand({ projectName, lockHeldExternally: true }),
      );
    } finally {
      await this.backupLock.release(projectName);
    }
  }

  // Extracted for testability — called by cron callback
  async executeDailySummary(): Promise<void> {
    this.logger.log('Daily summary triggered');
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const results = await this.getBackupStatus.execute(new GetBackupStatusQuery({}));
      const recentResults = results.filter((result) => result.startedAt >= since);

      if (recentResults.length === 0) {
        this.logger.log('No backups in the last 24 hours, skipping daily summary');
        return;
      }

      const notifierTypes = this.notifierRegistry.getRegisteredTypes();
      for (const type of notifierTypes) {
        const notifier = this.notifierRegistry.resolve(type);
        await notifier.notifyDailySummary(recentResults);
      }
    } catch (error) {
      this.logger.error(`Daily summary failed: ${(error as Error).message}`);
    }
  }

  private registerBackupJobs(): void {
    const projects = this.configLoader.loadAll().filter((project) => project.enabled);

    for (const config of projects) {
      const jobName = `backup-${config.name}`;
      const job = new CronJob(
        config.cron,
        () => { this.executeScheduledBackup(config.name).catch((err) => this.logger.error(`Scheduled backup failed for ${config.name}: ${(err as Error).message}`)); },
      );

      this.schedulerRegistry.addCronJob(jobName, job);
      job.start();
      this.logger.log(`Registered cron job "${jobName}" with schedule: ${config.cron}`);
    }
  }

  private registerDailySummaryJob(): void {
    const job = new CronJob(
      this.dailySummaryCron,
      () => { this.executeDailySummary().catch((err) => this.logger.error(`Daily summary failed: ${(err as Error).message}`)); },
    );

    this.schedulerRegistry.addCronJob('daily-summary', job);
    job.start();
    this.logger.log(`Registered daily summary cron: ${this.dailySummaryCron}`);
  }

  private clearAllJobs(): void {
    const jobNames = this.schedulerRegistry.getCronJobs();
    for (const [name] of jobNames) {
      this.schedulerRegistry.deleteCronJob(name);
      this.logger.log(`Removed cron job: ${name}`);
    }
  }
}
