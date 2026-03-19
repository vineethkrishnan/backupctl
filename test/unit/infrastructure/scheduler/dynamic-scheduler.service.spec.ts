import { SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { DynamicSchedulerService } from '@domain/backup/infrastructure/scheduler/dynamic-scheduler.service';
import { RunBackupUseCase } from '@domain/backup/application/use-cases/run-backup/run-backup.use-case';
import { NotifierRegistry } from '@domain/notification/application/registries/notifier.registry';
import { GetBackupStatusUseCase } from '@domain/audit/application/use-cases/get-backup-status/get-backup-status.use-case';
import { BackupLockPort } from '@domain/backup/application/ports/backup-lock.port';
import { ConfigLoaderPort } from '@domain/config/application/ports/config-loader.port';
import { ProjectConfig } from '@domain/config/domain/project-config.model';
import { RetentionPolicy } from '@domain/config/domain/retention-policy.model';
import { BackupResult } from '@domain/backup/domain/backup-result.model';
import { BackupStatus } from '@domain/backup/domain/value-objects/backup-status.enum';
import { BackupStage } from '@domain/backup/domain/value-objects/backup-stage.enum';
import { RunBackupCommand } from '@domain/backup/application/use-cases/run-backup/run-backup.command';
import { NotifierPort } from '@domain/notification/application/ports/notifier.port';

function createProjectConfig(overrides: Partial<{ name: string; cron: string; enabled: boolean }> = {}): ProjectConfig {
  return new ProjectConfig({
    name: overrides.name ?? 'test-project',
    enabled: overrides.enabled ?? true,
    cron: overrides.cron ?? '0 2 * * *',
    timeoutMinutes: null,
    database: {
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      name: 'testdb',
      user: 'testuser',
      password: 'testpass',
    },
    compression: { enabled: true },
    assets: { paths: [] },
    restic: {
      repositoryPath: '/repo/test',
      password: 'restic-pass',
      snapshotMode: 'combined',
    },
    retention: new RetentionPolicy(3, 7, 4, 6),
    encryption: null,
    hooks: null,
    verification: { enabled: false },
    notification: null,
  });
}

function createBackupResult(overrides: Partial<{ projectName: string; status: BackupStatus; startedAt: Date; errorMessage: string | null }> = {}): BackupResult {
  return new BackupResult({
    runId: 'run-1',
    projectName: overrides.projectName ?? 'test-project',
    status: overrides.status ?? BackupStatus.Success,
    currentStage: BackupStage.Audit,
    startedAt: overrides.startedAt ?? new Date(),
    completedAt: new Date(),
    dumpResult: null,
    syncResult: null,
    pruneResult: null,
    cleanupResult: null,
    encrypted: false,
    verified: false,
    snapshotMode: 'combined',
    errorStage: null,
    errorMessage: overrides.errorMessage ?? null,
    retryCount: 0,
    durationMs: 5000,
  });
}

describe('DynamicSchedulerService', () => {
  let service: DynamicSchedulerService;
  let schedulerRegistry: jest.Mocked<SchedulerRegistry>;
  let configLoader: jest.Mocked<ConfigLoaderPort>;
  let runBackup: jest.Mocked<RunBackupUseCase>;
  let backupLock: jest.Mocked<BackupLockPort>;
  let notifierRegistry: jest.Mocked<NotifierRegistry>;
  let getBackupStatus: jest.Mocked<GetBackupStatusUseCase>;
  let configService: jest.Mocked<ConfigService>;
  const registeredJobs: { stop: () => void }[] = [];

  beforeEach(() => {
    registeredJobs.length = 0;

    schedulerRegistry = {
      addCronJob: jest.fn().mockImplementation((_name: string, job: { stop: () => void }) => {
        registeredJobs.push(job);
      }),
      deleteCronJob: jest.fn(),
      getCronJobs: jest.fn().mockReturnValue(new Map()),
    } as unknown as jest.Mocked<SchedulerRegistry>;

    configLoader = {
      loadAll: jest.fn().mockReturnValue([]),
      getProject: jest.fn(),
      validate: jest.fn(),
      reload: jest.fn(),
    } as jest.Mocked<ConfigLoaderPort>;

    runBackup = {
      execute: jest.fn().mockResolvedValue([]),
      getDryRunReport: jest.fn(),
    } as unknown as jest.Mocked<RunBackupUseCase>;

    backupLock = {
      acquire: jest.fn(),
      acquireOrQueue: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      isLocked: jest.fn(),
    } as jest.Mocked<BackupLockPort>;

    notifierRegistry = {
      resolve: jest.fn(),
      register: jest.fn(),
      getRegisteredTypes: jest.fn().mockReturnValue([]),
    } as unknown as jest.Mocked<NotifierRegistry>;

    getBackupStatus = {
      execute: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<GetBackupStatusUseCase>;

    configService = {
      get: jest.fn().mockReturnValue('0 7 * * *'),
    } as unknown as jest.Mocked<ConfigService>;

    service = new DynamicSchedulerService(
      schedulerRegistry,
      configLoader,
      runBackup,
      backupLock,
      notifierRegistry,
      getBackupStatus,
      configService,
    );
  });

  afterEach(() => {
    for (const job of registeredJobs) {
      job.stop();
    }
  });

  describe('onModuleInit', () => {
    it('should register cron jobs for each enabled project', async () => {
      const locaboo = createProjectConfig({ name: 'locaboo', cron: '0 2 * * *' });
      const shopify = createProjectConfig({ name: 'shopify', cron: '0 3 * * *' });
      configLoader.loadAll.mockReturnValue([locaboo, shopify]);

      await service.onModuleInit();

      expect(schedulerRegistry.addCronJob).toHaveBeenCalledWith(
        'backup-locaboo',
        expect.objectContaining({ cronTime: expect.anything() }),
      );
      expect(schedulerRegistry.addCronJob).toHaveBeenCalledWith(
        'backup-shopify',
        expect.objectContaining({ cronTime: expect.anything() }),
      );
    });

    it('should not register jobs for disabled projects', async () => {
      const disabled = createProjectConfig({ name: 'disabled', enabled: false });
      configLoader.loadAll.mockReturnValue([disabled]);

      await service.onModuleInit();

      expect(schedulerRegistry.addCronJob).not.toHaveBeenCalledWith(
        'backup-disabled',
        expect.anything(),
      );
    });

    it('should register daily summary cron job', async () => {
      configLoader.loadAll.mockReturnValue([]);

      await service.onModuleInit();

      expect(schedulerRegistry.addCronJob).toHaveBeenCalledWith(
        'daily-summary',
        expect.objectContaining({ cronTime: expect.anything() }),
      );
    });
  });

  describe('executeScheduledBackup', () => {
    it('should acquire lock, run backup with lockHeldExternally, then release', async () => {
      await service.executeScheduledBackup('locaboo');

      expect(backupLock.acquireOrQueue).toHaveBeenCalledWith('locaboo');
      expect(runBackup.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          projectName: 'locaboo',
          lockHeldExternally: true,
        }),
      );
      expect(backupLock.release).toHaveBeenCalledWith('locaboo');
    });

    it('should release lock even when backup throws', async () => {
      runBackup.execute.mockRejectedValueOnce(new Error('dump failed'));

      await expect(service.executeScheduledBackup('locaboo')).rejects.toThrow('dump failed');

      expect(backupLock.acquireOrQueue).toHaveBeenCalledWith('locaboo');
      expect(backupLock.release).toHaveBeenCalledWith('locaboo');
    });

    it('should pass correct RunBackupCommand', async () => {
      await service.executeScheduledBackup('shopify');

      const command = runBackup.execute.mock.calls[0]![0] as RunBackupCommand;
      expect(command.projectName).toBe('shopify');
      expect(command.lockHeldExternally).toBe(true);
      expect(command.isDryRun).toBe(false);
      expect(command.isAll).toBe(false);
    });
  });

  describe('executeDailySummary', () => {
    it('should skip notification when no recent backups exist', async () => {
      getBackupStatus.execute.mockResolvedValue([]);

      await service.executeDailySummary();

      expect(notifierRegistry.getRegisteredTypes).not.toHaveBeenCalled();
    });

    it('should send daily summary to all registered notifiers', async () => {
      const recentResult = createBackupResult({
        projectName: 'locaboo',
        startedAt: new Date(),
      });
      getBackupStatus.execute.mockResolvedValue([recentResult]);

      const mockNotifier: jest.Mocked<NotifierPort> = {
        notifyStarted: jest.fn(),
        notifySuccess: jest.fn(),
        notifyFailure: jest.fn(),
        notifyWarning: jest.fn(),
        notifyDailySummary: jest.fn().mockResolvedValue(undefined),
      };
      notifierRegistry.getRegisteredTypes.mockReturnValue(['slack']);
      notifierRegistry.resolve.mockReturnValue(mockNotifier);

      await service.executeDailySummary();

      expect(mockNotifier.notifyDailySummary).toHaveBeenCalledWith([recentResult]);
    });

    it('should filter out results older than 24 hours', async () => {
      const oldResult = createBackupResult({
        projectName: 'old-project',
        startedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      });
      getBackupStatus.execute.mockResolvedValue([oldResult]);

      await service.executeDailySummary();

      expect(notifierRegistry.getRegisteredTypes).not.toHaveBeenCalled();
    });

    it('should catch and log errors without throwing', async () => {
      getBackupStatus.execute.mockRejectedValueOnce(new Error('DB connection lost'));

      await expect(service.executeDailySummary()).resolves.not.toThrow();
    });
  });

  describe('backup cron callback', () => {
    it('registers backup job with correct name for each project', async () => {
      const locaboo = createProjectConfig({ name: 'locaboo' });
      const shopify = createProjectConfig({ name: 'shopify' });
      configLoader.loadAll.mockReturnValue([locaboo, shopify]);

      await service.onModuleInit();

      const jobNames = schedulerRegistry.addCronJob.mock.calls.map((call) => call[0] as string);
      expect(jobNames).toContain('backup-locaboo');
      expect(jobNames).toContain('backup-shopify');
      expect(jobNames).toContain('daily-summary');
    });

    it('does not execute backup until cron fires', async () => {
      configLoader.loadAll.mockReturnValue([createProjectConfig({ name: 'test' })]);

      await service.onModuleInit();

      expect(backupLock.acquireOrQueue).not.toHaveBeenCalled();
      expect(runBackup.execute).not.toHaveBeenCalled();
    });
  });

  describe('reRegisterJobs', () => {
    it('should clear existing jobs before re-registering', () => {
      const existingJobs = new Map<string, unknown>([
        ['backup-old', {}],
        ['daily-summary', {}],
      ]);
      schedulerRegistry.getCronJobs.mockReturnValue(existingJobs as Map<string, never>);
      configLoader.loadAll.mockReturnValue([]);

      service.reRegisterJobs();

      expect(schedulerRegistry.deleteCronJob).toHaveBeenCalledWith('backup-old');
      expect(schedulerRegistry.deleteCronJob).toHaveBeenCalledWith('daily-summary');
    });

    it('should re-read config and register new jobs', () => {
      schedulerRegistry.getCronJobs.mockReturnValue(new Map());
      const newProject = createProjectConfig({ name: 'new-project', cron: '0 4 * * *' });
      configLoader.loadAll.mockReturnValue([newProject]);

      service.reRegisterJobs();

      expect(configLoader.loadAll).toHaveBeenCalled();
      expect(schedulerRegistry.addCronJob).toHaveBeenCalledWith(
        'backup-new-project',
        expect.objectContaining({ cronTime: expect.anything() }),
      );
      expect(schedulerRegistry.addCronJob).toHaveBeenCalledWith(
        'daily-summary',
        expect.objectContaining({ cronTime: expect.anything() }),
      );
    });
  });

  describe('daily summary registration', () => {
    it('registers daily-summary job with configured cron', async () => {
      configLoader.loadAll.mockReturnValue([]);
      configService.get.mockReturnValue('30 8 * * *');

      service = new DynamicSchedulerService(
        schedulerRegistry,
        configLoader,
        runBackup,
        backupLock,
        notifierRegistry,
        getBackupStatus,
        configService,
      );

      await service.onModuleInit();

      expect(schedulerRegistry.addCronJob).toHaveBeenCalledWith(
        'daily-summary',
        expect.anything(),
      );
    });
  });
});
