import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import { BackupLockPort } from '@domain/backup/ports/backup-lock.port';
import { ConfigLoaderPort } from '@domain/config/ports/config-loader.port';
import { BackupOrchestratorService } from '@application/backup/backup-orchestrator.service';
import { NotifierRegistry } from '@application/backup/registries/notifier.registry';
import { AuditQueryService } from '@application/audit/audit-query.service';
import {
  BACKUP_LOCK_PORT,
  CONFIG_LOADER_PORT,
  NOTIFIER_REGISTRY,
} from '@shared/injection-tokens';

@Injectable()
export class DynamicSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(DynamicSchedulerService.name);
  private readonly dailySummaryCron: string;

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    @Inject(CONFIG_LOADER_PORT) private readonly configLoader: ConfigLoaderPort,
    private readonly backupOrchestrator: BackupOrchestratorService,
    @Inject(BACKUP_LOCK_PORT) private readonly backupLock: BackupLockPort,
    @Inject(NOTIFIER_REGISTRY) private readonly notifierRegistry: NotifierRegistry,
    private readonly auditQueryService: AuditQueryService,
    configService: ConfigService,
  ) {
    this.dailySummaryCron = configService.get<string>('DAILY_SUMMARY_CRON', '0 7 * * *');
  }

  // ── Module initialization ───────────────────────────────────────────

  async onModuleInit(): Promise<void> {
    this.registerBackupJobs();
    this.registerDailySummaryJob();
  }

  // ── Re-register all jobs after config reload ────────────────────────

  reRegisterJobs(): void {
    this.clearAllJobs();
    this.registerBackupJobs();
    this.registerDailySummaryJob();
    this.logger.log('All cron jobs re-registered after config reload');
  }

  // ── Private: register backup cron jobs ──────────────────────────────

  private registerBackupJobs(): void {
    const projects = this.configLoader.loadAll().filter((project) => project.enabled);

    for (const config of projects) {
      const jobName = `backup-${config.name}`;
      const job = new CronJob(config.cron, async () => {
        this.logger.log(`Scheduled backup triggered for ${config.name}`);
        await this.backupLock.acquireOrQueue(config.name);
        try {
          await this.backupOrchestrator.runBackup(config.name);
        } finally {
          await this.backupLock.release(config.name);
        }
      });

      this.schedulerRegistry.addCronJob(jobName, job);
      job.start();
      this.logger.log(`Registered cron job "${jobName}" with schedule: ${config.cron}`);
    }
  }

  // ── Private: register daily summary cron ────────────────────────────

  private registerDailySummaryJob(): void {
    const job = new CronJob(this.dailySummaryCron, async () => {
      this.logger.log('Daily summary triggered');
      try {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const results = await this.auditQueryService.getStatus(undefined, undefined);
        const recentResults = results.filter(
          (result) => result.startedAt >= since,
        );

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
    });

    this.schedulerRegistry.addCronJob('daily-summary', job);
    job.start();
    this.logger.log(`Registered daily summary cron: ${this.dailySummaryCron}`);
  }

  // ── Private: clear all registered cron jobs ─────────────────────────

  private clearAllJobs(): void {
    const jobNames = this.schedulerRegistry.getCronJobs();
    for (const [name] of jobNames) {
      this.schedulerRegistry.deleteCronJob(name);
      this.logger.log(`Removed cron job: ${name}`);
    }
  }
}
