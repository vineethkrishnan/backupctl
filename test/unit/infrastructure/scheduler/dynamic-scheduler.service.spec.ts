import { SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { DynamicSchedulerService } from '@infrastructure/scheduler/dynamic-scheduler.service';
import { BackupOrchestratorService } from '@application/backup/backup-orchestrator.service';
import { NotifierRegistry } from '@application/backup/registries/notifier.registry';
import { AuditQueryService } from '@application/audit/audit-query.service';
import { BackupLockPort } from '@domain/backup/ports/backup-lock.port';
import { ConfigLoaderPort } from '@domain/config/ports/config-loader.port';
import { ProjectConfig } from '@domain/config/models/project-config.model';
import { RetentionPolicy } from '@domain/config/models/retention-policy.model';

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

describe('DynamicSchedulerService', () => {
  let service: DynamicSchedulerService;
  let schedulerRegistry: jest.Mocked<SchedulerRegistry>;
  let configLoader: jest.Mocked<ConfigLoaderPort>;
  let backupOrchestrator: jest.Mocked<BackupOrchestratorService>;
  let backupLock: jest.Mocked<BackupLockPort>;
  let notifierRegistry: jest.Mocked<NotifierRegistry>;
  let auditQueryService: jest.Mocked<AuditQueryService>;
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

    backupOrchestrator = {
      runBackup: jest.fn(),
      runAllBackups: jest.fn(),
    } as unknown as jest.Mocked<BackupOrchestratorService>;

    backupLock = {
      acquire: jest.fn(),
      acquireOrQueue: jest.fn(),
      release: jest.fn(),
      isLocked: jest.fn(),
    } as jest.Mocked<BackupLockPort>;

    notifierRegistry = {
      resolve: jest.fn(),
      register: jest.fn(),
      getRegisteredTypes: jest.fn().mockReturnValue([]),
    } as unknown as jest.Mocked<NotifierRegistry>;

    auditQueryService = {
      getStatus: jest.fn().mockResolvedValue([]),
      getFailedLogs: jest.fn(),
    } as unknown as jest.Mocked<AuditQueryService>;

    configService = {
      get: jest.fn().mockReturnValue('0 7 * * *'),
    } as unknown as jest.Mocked<ConfigService>;

    service = new DynamicSchedulerService(
      schedulerRegistry,
      configLoader,
      backupOrchestrator,
      backupLock,
      notifierRegistry,
      auditQueryService,
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
});
