import { TestingModule } from '@nestjs/testing';
import { CommandTestFactory } from 'nest-commander-testing';

import { RunCommand } from '@domain/backup/presenters/cli/run.command';
import { HealthCommand } from '@domain/health/presenters/cli/health.command';
import { SnapshotsCommand } from '@domain/backup/presenters/cli/snapshots.command';
import {
  ConfigCommand,
  ConfigValidateSubCommand,
  ConfigShowSubCommand,
  ConfigReloadSubCommand,
  ConfigImportGpgKeySubCommand,
} from '@domain/config/presenters/cli/config.command';

import { RunBackupUseCase } from '@domain/backup/application/use-cases/run-backup/run-backup.use-case';
import { CheckHealthUseCase } from '@domain/health/application/use-cases/check-health/check-health.use-case';
import { ListSnapshotsUseCase } from '@domain/backup/application/use-cases/list-snapshots/list-snapshots.use-case';
import { ConfigLoaderPort, ValidationResult } from '@domain/config/application/ports/config-loader.port';
import { BackupResult } from '@domain/backup/domain/backup-result.model';
import { BackupStage } from '@domain/backup/domain/value-objects/backup-stage.enum';
import { BackupStatus } from '@domain/backup/domain/value-objects/backup-status.enum';
import { HealthCheckResult } from '@domain/audit/domain/health-check-result.model';
import { SnapshotInfo } from '@domain/backup/domain/value-objects/snapshot-info.model';
import { ProjectConfig } from '@domain/config/domain/project-config.model';
import { RetentionPolicy } from '@domain/config/domain/retention-policy.model';
import { GpgKeyManagerPort } from '@domain/backup/application/ports/gpg-key-manager.port';
import { CONFIG_LOADER_PORT, GPG_KEY_MANAGER_PORT } from '@common/di/injection-tokens';

jest.setTimeout(30000);

function buildResult(overrides: Partial<BackupResult> = {}): BackupResult {
  return new BackupResult({
    runId: 'run-1',
    projectName: 'locaboo',
    status: BackupStatus.Success,
    currentStage: BackupStage.NotifyResult,
    startedAt: new Date('2026-03-18T02:00:00Z'),
    completedAt: new Date('2026-03-18T02:05:00Z'),
    dumpResult: null,
    syncResult: null,
    pruneResult: null,
    cleanupResult: null,
    encrypted: false,
    verified: false,
    snapshotMode: 'combined',
    errorStage: null,
    errorMessage: null,
    retryCount: 0,
    durationMs: 300000,
    ...overrides,
  });
}

function buildTestConfig(): ProjectConfig {
  return new ProjectConfig({
    name: 'locaboo',
    enabled: true,
    cron: '0 2 * * *',
    timeoutMinutes: null,
    database: {
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      name: 'locaboo_prod',
      user: 'user',
      password: 'pass',
    },
    compression: { enabled: true },
    assets: { paths: [] },
    restic: {
      repositoryPath: '/backups/locaboo',
      password: 'rpass',
      snapshotMode: 'combined',
    },
    retention: new RetentionPolicy(7, 7, 4),
    encryption: null,
    hooks: null,
    verification: { enabled: false },
    notification: null,
  });
}

describe('CLI commands (integration)', () => {
  let commandModule: TestingModule;

  let mockOrchestrator: jest.Mocked<RunBackupUseCase>;
  let mockHealthCheck: jest.Mocked<CheckHealthUseCase>;
  let mockSnapshotManagement: jest.Mocked<ListSnapshotsUseCase>;
  let mockConfigLoader: jest.Mocked<ConfigLoaderPort>;
  let mockGpgKeyManager: jest.Mocked<GpgKeyManagerPort>;

  beforeEach(async () => {
    mockOrchestrator = {
      execute: jest.fn(),
      getDryRunReport: jest.fn(),
    } as unknown as jest.Mocked<RunBackupUseCase>;

    mockHealthCheck = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<CheckHealthUseCase>;

    mockSnapshotManagement = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<ListSnapshotsUseCase>;

    mockConfigLoader = {
      loadAll: jest.fn().mockReturnValue([buildTestConfig()]),
      getProject: jest.fn().mockReturnValue(buildTestConfig()),
      validate: jest.fn().mockReturnValue({ isValid: true, errors: [] } satisfies ValidationResult),
      reload: jest.fn(),
    };

    mockGpgKeyManager = {
      importKey: jest.fn().mockResolvedValue(undefined),
      importAllFromDirectory: jest.fn().mockResolvedValue([]),
      listKeys: jest.fn().mockResolvedValue(''),
      hasKey: jest.fn().mockResolvedValue(true),
    } as jest.Mocked<GpgKeyManagerPort>;

    process.exitCode = undefined;
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    commandModule = await CommandTestFactory.createTestingCommand({
      imports: [],
      providers: [
        RunCommand,
        HealthCommand,
        SnapshotsCommand,
        ConfigCommand,
        ConfigValidateSubCommand,
        ConfigShowSubCommand,
        ConfigReloadSubCommand,
        ConfigImportGpgKeySubCommand,
        { provide: RunBackupUseCase, useValue: mockOrchestrator },
        { provide: CheckHealthUseCase, useValue: mockHealthCheck },
        { provide: ListSnapshotsUseCase, useValue: mockSnapshotManagement },
        { provide: CONFIG_LOADER_PORT, useValue: mockConfigLoader },
        { provide: GPG_KEY_MANAGER_PORT, useValue: mockGpgKeyManager },
      ],
    }).compile();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = undefined;
  });

  describe('run command', () => {
    it('should trigger backup for a named project', async () => {
      mockOrchestrator.execute.mockResolvedValue([buildResult()]);

      await CommandTestFactory.run(commandModule, ['run', 'locaboo']);

      expect(mockOrchestrator.execute).toHaveBeenCalledWith(
        expect.objectContaining({ projectName: 'locaboo', isAll: false }),
      );
    });

    it('should trigger all backups with --all flag', async () => {
      mockOrchestrator.execute.mockResolvedValue([buildResult()]);

      await CommandTestFactory.run(commandModule, ['run', '--all']);

      expect(mockOrchestrator.execute).toHaveBeenCalledWith(
        expect.objectContaining({ isAll: true }),
      );
    });

    it('should call getDryRunReport for --dry-run flag', async () => {
      mockOrchestrator.getDryRunReport.mockResolvedValue({
        projectName: 'locaboo',
        checks: [{ name: 'Config loaded', passed: true, message: 'OK' }],
        allPassed: true,
      });

      await CommandTestFactory.run(commandModule, ['run', 'locaboo', '--dry-run']);

      expect(mockOrchestrator.getDryRunReport).toHaveBeenCalledWith('locaboo');
      expect(mockOrchestrator.execute).not.toHaveBeenCalled();
    });
  });

  describe('health command', () => {
    it('should call health check and display results', async () => {
      mockHealthCheck.execute.mockResolvedValue(
        new HealthCheckResult(true, true, 50, true, true, true, 3600),
      );

      await CommandTestFactory.run(commandModule, ['health']);

      expect(mockHealthCheck.execute).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith('System healthy');
    });

    it('should report unhealthy when audit DB is down', async () => {
      mockHealthCheck.execute.mockResolvedValue(
        new HealthCheckResult(false, true, 50, true, true, true, 3600),
      );

      await CommandTestFactory.run(commandModule, ['health']);

      expect(console.log).toHaveBeenCalledWith('System unhealthy');
    });
  });

  describe('config validate command', () => {
    it('should report valid configuration', async () => {
      await CommandTestFactory.run(commandModule, ['config', 'validate']);

      expect(mockConfigLoader.validate).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith('Configuration is valid.');
    });

    it('should report configuration errors', async () => {
      mockConfigLoader.validate.mockReturnValue({
        isValid: false,
        errors: ['Project "locaboo": missing required field: cron'],
      });

      await CommandTestFactory.run(commandModule, ['config', 'validate']);

      expect(console.error).toHaveBeenCalledWith('Configuration errors:');
    });
  });

  describe('snapshots command', () => {
    it('should list snapshots for a project', async () => {
      mockSnapshotManagement.execute.mockResolvedValue([
        new SnapshotInfo(
          'abc123def456',
          '2026-03-18T02:05:00Z',
          ['/data/backups/locaboo'],
          'backupctl',
          ['project:locaboo', 'db:postgres'],
          '512MB',
        ),
      ]);

      await CommandTestFactory.run(commandModule, ['snapshots', 'locaboo']);

      expect(mockSnapshotManagement.execute).toHaveBeenCalledWith(
        expect.objectContaining({ projectName: 'locaboo' }),
      );
    });

    it('should display message when no snapshots found', async () => {
      mockSnapshotManagement.execute.mockResolvedValue([]);

      await CommandTestFactory.run(commandModule, ['snapshots', 'locaboo']);

      expect(console.log).toHaveBeenCalledWith('No snapshots found for locaboo.');
    });
  });
});
