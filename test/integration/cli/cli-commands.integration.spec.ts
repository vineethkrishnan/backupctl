import { TestingModule } from '@nestjs/testing';
import { CommandTestFactory } from 'nest-commander-testing';

import { RunCommand } from '@infrastructure/cli/commands/run.command';
import { HealthCommand } from '@infrastructure/cli/commands/health.command';
import { SnapshotsCommand } from '@infrastructure/cli/commands/snapshots.command';
import {
  ConfigCommand,
  ConfigValidateSubCommand,
  ConfigShowSubCommand,
  ConfigReloadSubCommand,
  ConfigImportGpgKeySubCommand,
} from '@infrastructure/cli/commands/config.command';

import { BackupOrchestratorService } from '@application/backup/backup-orchestrator.service';
import { HealthCheckService } from '@application/health/health-check.service';
import { SnapshotManagementService } from '@application/snapshot/snapshot-management.service';
import { ConfigLoaderPort, ValidationResult } from '@domain/config/ports/config-loader.port';
import { BackupResult } from '@domain/backup/models/backup-result.model';
import { BackupStage } from '@domain/backup/models/backup-stage.enum';
import { BackupStatus } from '@domain/backup/models/backup-status.enum';
import { HealthCheckResult } from '@domain/audit/models/health-check-result.model';
import { SnapshotInfo } from '@domain/backup/models/snapshot-info.model';
import { ProjectConfig } from '@domain/config/models/project-config.model';
import { RetentionPolicy } from '@domain/config/models/retention-policy.model';
import { GpgKeyManager } from '@infrastructure/adapters/encryptors/gpg-key-manager';
import { CONFIG_LOADER_PORT } from '@shared/injection-tokens';

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

  let mockOrchestrator: jest.Mocked<BackupOrchestratorService>;
  let mockHealthCheck: jest.Mocked<HealthCheckService>;
  let mockSnapshotManagement: jest.Mocked<SnapshotManagementService>;
  let mockConfigLoader: jest.Mocked<ConfigLoaderPort>;
  let mockGpgKeyManager: jest.Mocked<GpgKeyManager>;

  beforeEach(async () => {
    mockOrchestrator = {
      runBackup: jest.fn(),
      runAllBackups: jest.fn(),
      restoreBackup: jest.fn(),
      getRestoreGuide: jest.fn(),
      pruneProject: jest.fn(),
      pruneAll: jest.fn(),
    } as unknown as jest.Mocked<BackupOrchestratorService>;

    mockHealthCheck = {
      checkHealth: jest.fn(),
    } as unknown as jest.Mocked<HealthCheckService>;

    mockSnapshotManagement = {
      listSnapshots: jest.fn(),
    } as unknown as jest.Mocked<SnapshotManagementService>;

    mockConfigLoader = {
      loadAll: jest.fn().mockReturnValue([buildTestConfig()]),
      getProject: jest.fn().mockReturnValue(buildTestConfig()),
      validate: jest.fn().mockReturnValue({ isValid: true, errors: [] } satisfies ValidationResult),
      reload: jest.fn(),
    };

    mockGpgKeyManager = {
      importKey: jest.fn().mockResolvedValue(undefined),
      importKeysFromDir: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<GpgKeyManager>;

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
        { provide: BackupOrchestratorService, useValue: mockOrchestrator },
        { provide: HealthCheckService, useValue: mockHealthCheck },
        { provide: SnapshotManagementService, useValue: mockSnapshotManagement },
        { provide: CONFIG_LOADER_PORT, useValue: mockConfigLoader },
        { provide: GpgKeyManager, useValue: mockGpgKeyManager },
      ],
    }).compile();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = undefined;
  });

  describe('run command', () => {
    it('should trigger backup for a named project', async () => {
      mockOrchestrator.runBackup.mockResolvedValue(buildResult());

      await CommandTestFactory.run(commandModule, ['run', 'locaboo']);

      expect(mockOrchestrator.runBackup).toHaveBeenCalledWith('locaboo');
    });

    it('should trigger all backups with --all flag', async () => {
      mockOrchestrator.runAllBackups.mockResolvedValue([buildResult()]);

      await CommandTestFactory.run(commandModule, ['run', '--all']);

      expect(mockOrchestrator.runAllBackups).toHaveBeenCalled();
    });

    it('should call executeDryRun for --dry-run flag', async () => {
      mockOrchestrator.executeDryRun = jest.fn().mockResolvedValue({
        projectName: 'locaboo',
        checks: [{ name: 'Config loaded', passed: true, message: 'OK' }],
        allPassed: true,
      });

      await CommandTestFactory.run(commandModule, ['run', 'locaboo', '--dry-run']);

      expect(mockOrchestrator.executeDryRun).toHaveBeenCalledWith('locaboo');
      expect(mockOrchestrator.runBackup).not.toHaveBeenCalled();
    });
  });

  describe('health command', () => {
    it('should call health check and display results', async () => {
      mockHealthCheck.checkHealth.mockResolvedValue(
        new HealthCheckResult(true, true, 50, true, true, true, 3600),
      );

      await CommandTestFactory.run(commandModule, ['health']);

      expect(mockHealthCheck.checkHealth).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith('System healthy');
    });

    it('should report unhealthy when audit DB is down', async () => {
      mockHealthCheck.checkHealth.mockResolvedValue(
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
      mockSnapshotManagement.listSnapshots.mockResolvedValue([
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

      expect(mockSnapshotManagement.listSnapshots).toHaveBeenCalledWith('locaboo', undefined);
    });

    it('should display message when no snapshots found', async () => {
      mockSnapshotManagement.listSnapshots.mockResolvedValue([]);

      await CommandTestFactory.run(commandModule, ['snapshots', 'locaboo']);

      expect(console.log).toHaveBeenCalledWith('No snapshots found for locaboo.');
    });
  });
});
