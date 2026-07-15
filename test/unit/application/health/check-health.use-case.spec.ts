import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CheckHealthUseCase } from '@domain/health/application/use-cases/check-health/check-health.use-case';
import { AuditLogPort } from '@domain/audit/application/ports/audit-log.port';
import { SystemHealthPort } from '@domain/health/application/ports/system-health.port';
import { HeartbeatMonitorPort } from '@domain/backup/application/ports/heartbeat-monitor.port';
import { RemoteStorageFactoryPort } from '@domain/backup/application/ports/remote-storage-factory.port';
import { RemoteStoragePort } from '@domain/backup/application/ports/remote-storage.port';
import { ConfigLoaderPort } from '@domain/config/application/ports/config-loader.port';
import { StorageBackendType } from '@domain/config/domain/storage-config.model';
import { ClockPort } from '@common/clock/clock.port';
import { buildProjectConfig } from '@test/support/project-config.builder';
import { createMockRemoteStorage } from '@test/support/remote-storage.mock';
import {
  AUDIT_LOG_PORT,
  CLOCK_PORT,
  CONFIG_LOADER_PORT,
  HEARTBEAT_MONITOR_PORT,
  REMOTE_STORAGE_FACTORY,
  SYSTEM_HEALTH_PORT,
} from '@common/di/injection-tokens';

describe('CheckHealthUseCase', () => {
  let service: CheckHealthUseCase;
  let mockAuditLog: jest.Mocked<AuditLogPort>;
  let mockSystemHealth: jest.Mocked<SystemHealthPort>;
  let mockHeartbeatMonitor: jest.Mocked<HeartbeatMonitorPort>;
  let mockConfigLoader: jest.Mocked<ConfigLoaderPort>;
  let mockStorageFactory: jest.Mocked<RemoteStorageFactoryPort>;
  let mockStorage: jest.Mocked<RemoteStoragePort>;
  let configValues: Record<string, unknown>;
  let currentTime: Date;

  function setProjects(projects: Array<{ name: string; type: StorageBackendType; enabled?: boolean }>): void {
    const configs = projects.map((project) =>
      buildProjectConfig({
        name: project.name,
        enabled: project.enabled ?? true,
        storage: {
          type: project.type,
          repository: 'repo',
          password: 'pass',
          snapshotMode: 'combined',
          config: {},
        },
      }),
    );

    mockConfigLoader.loadAll.mockReturnValue(configs);
    mockConfigLoader.getProject.mockImplementation((name: string) => {
      const found = configs.find((config) => config.name === name);
      if (!found) throw new Error(`Project "${name}" not found`);
      return found;
    });
  }

  beforeEach(async () => {
    currentTime = new Date('2026-07-15T10:00:00Z');

    mockAuditLog = {
      startRun: jest.fn(),
      trackProgress: jest.fn(),
      finishRun: jest.fn(),
      findByProject: jest.fn(),
      findFailed: jest.fn(),
      findSince: jest.fn().mockResolvedValue([]),
      findOrphaned: jest.fn(),
    };

    mockSystemHealth = {
      checkDiskSpace: jest.fn().mockResolvedValue({ available: true, freeGb: 20 }),
    };

    mockHeartbeatMonitor = {
      sendHeartbeat: jest.fn().mockResolvedValue(undefined),
      checkConnectivity: jest.fn().mockResolvedValue(true),
    };

    mockStorage = createMockRemoteStorage();

    mockStorageFactory = { create: jest.fn().mockReturnValue(mockStorage) };

    mockConfigLoader = {
      loadAll: jest.fn().mockReturnValue([]),
      getProject: jest.fn(),
      validate: jest.fn(),
      reload: jest.fn(),
    };

    configValues = { HEALTH_DISK_MIN_FREE_GB: 5 };

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: unknown) => configValues[key] ?? defaultValue),
    } as unknown as ConfigService;

    const mockClock: jest.Mocked<ClockPort> = {
      now: jest.fn(() => currentTime),
      timestamp: jest.fn().mockReturnValue('20260715-100000'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CheckHealthUseCase,
        { provide: AUDIT_LOG_PORT, useValue: mockAuditLog },
        { provide: SYSTEM_HEALTH_PORT, useValue: mockSystemHealth },
        { provide: HEARTBEAT_MONITOR_PORT, useValue: mockHeartbeatMonitor },
        { provide: CONFIG_LOADER_PORT, useValue: mockConfigLoader },
        { provide: REMOTE_STORAGE_FACTORY, useValue: mockStorageFactory },
        { provide: CLOCK_PORT, useValue: mockClock },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get(CheckHealthUseCase);
    setProjects([{ name: 'vinsware', type: 'sftp' }]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns healthy result when all checks pass', async () => {
    const result = await service.execute();

    expect(result.auditDbConnected).toBe(true);
    expect(result.diskSpaceAvailable).toBe(true);
    expect(result.diskFreeGb).toBe(20);
    expect(result.storageChecks).toEqual([
      { project: 'vinsware', backendType: 'sftp', reachable: true, error: null },
    ]);
    expect(result.isHealthy()).toBe(true);
    expect(mockHeartbeatMonitor.checkConnectivity).not.toHaveBeenCalled();
  });

  it('calls checkConnectivity and sets uptimeKumaConfigured when UPTIME_KUMA_BASE_URL is set', async () => {
    configValues['UPTIME_KUMA_BASE_URL'] = 'https://kuma.example.com';

    const result = await service.execute();

    expect(mockHeartbeatMonitor.checkConnectivity).toHaveBeenCalledTimes(1);
    expect(result.uptimeKumaConfigured).toBe(true);
    expect(result.uptimeKumaConnected).toBe(true);
  });

  it('does not call checkConnectivity when UPTIME_KUMA_BASE_URL is not set', async () => {
    const result = await service.execute();

    expect(mockHeartbeatMonitor.checkConnectivity).not.toHaveBeenCalled();
    expect(result.uptimeKumaConfigured).toBe(false);
    expect(result.uptimeKumaConnected).toBe(false);
  });

  it('isHealthy() ignores Uptime Kuma when Kuma is unreachable but core checks pass', async () => {
    configValues['UPTIME_KUMA_BASE_URL'] = 'https://kuma.example.com';
    mockHeartbeatMonitor.checkConnectivity.mockResolvedValue(false);

    const result = await service.execute();

    expect(result.uptimeKumaConnected).toBe(false);
    expect(result.isHealthy()).toBe(true);
  });

  it('returns unhealthy when audit DB is down', async () => {
    mockAuditLog.findSince.mockRejectedValue(new Error('Connection refused'));

    const result = await service.execute();

    expect(result.auditDbConnected).toBe(false);
    expect(result.isHealthy()).toBe(false);
  });

  it('disk space check fails when below threshold', async () => {
    configValues['HEALTH_DISK_MIN_FREE_GB'] = 50;
    mockSystemHealth.checkDiskSpace.mockResolvedValue({ available: false, freeGb: 10 });

    const result = await service.execute();

    expect(result.diskSpaceAvailable).toBe(false);
    expect(result.diskFreeGb).toBe(10);
    expect(result.isHealthy()).toBe(false);
  });

  it('disk check passes when free space equals threshold', async () => {
    configValues['HEALTH_DISK_MIN_FREE_GB'] = 10;
    mockSystemHealth.checkDiskSpace.mockResolvedValue({ available: true, freeGb: 10 });

    const result = await service.execute();

    expect(result.diskSpaceAvailable).toBe(true);
    expect(mockSystemHealth.checkDiskSpace).toHaveBeenCalledWith('/', 10);
  });

  describe('storage backend checks', () => {
    it('probes every enabled project through its own storage port', async () => {
      setProjects([
        { name: 'a', type: 's3' },
        { name: 'b', type: 'rclone' },
      ]);

      const result = await service.execute();

      expect(mockStorage.checkConnectivity).toHaveBeenCalledTimes(2);
      expect(result.storageChecks).toEqual([
        { project: 'a', backendType: 's3', reachable: true, error: null },
        { project: 'b', backendType: 'rclone', reachable: true, error: null },
      ]);
    });

    it('skips disabled projects', async () => {
      setProjects([
        { name: 'a', type: 's3' },
        { name: 'b', type: 's3', enabled: false },
      ]);

      const result = await service.execute();

      expect(result.storageChecks).toHaveLength(1);
      expect(result.storageChecks[0].project).toBe('a');
    });

    it('reports a repo as unreachable with the underlying error, and turns the result unhealthy', async () => {
      mockStorage.checkConnectivity.mockRejectedValue(new Error('Fatal: unable to open config file'));

      const result = await service.execute();

      expect(result.storageChecks).toEqual([
        {
          project: 'vinsware',
          backendType: 'sftp',
          reachable: false,
          error: 'Fatal: unable to open config file',
        },
      ]);
      expect(result.isHealthy()).toBe(false);
    });

    it('isolates a failing project from a healthy one', async () => {
      setProjects([
        { name: 'good', type: 's3' },
        { name: 'bad', type: 's3' },
      ]);
      mockStorage.checkConnectivity
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('403 Forbidden'));

      const result = await service.execute();

      expect(result.storageChecks[0].reachable).toBe(true);
      expect(result.storageChecks[1].reachable).toBe(false);
      expect(result.isHealthy()).toBe(false);
    });

    it('reports unreachable rather than throwing when the factory itself throws', async () => {
      mockStorageFactory.create.mockImplementation(() => {
        throw new Error('Restic password not configured');
      });

      const result = await service.execute();

      expect(result.storageChecks[0].reachable).toBe(false);
      expect(result.storageChecks[0].error).toContain('Restic password not configured');
    });

    it('is healthy with no storage checks when the config cannot be read', async () => {
      mockConfigLoader.loadAll.mockImplementation(() => {
        throw new Error('projects.yml is malformed');
      });

      const result = await service.execute();

      expect(result.storageChecks).toEqual([]);
      expect(result.isHealthy()).toBe(true);
    });
  });

  describe('storage check caching', () => {
    it('does not re-probe within the TTL', async () => {
      await service.execute();
      await service.execute();
      await service.execute();

      expect(mockStorage.checkConnectivity).toHaveBeenCalledTimes(1);
    });

    it('re-probes once the TTL has elapsed', async () => {
      await service.execute();

      currentTime = new Date(currentTime.getTime() + 301_000);
      await service.execute();

      expect(mockStorage.checkConnectivity).toHaveBeenCalledTimes(2);
    });

    it('serves the cached result within the TTL', async () => {
      const first = await service.execute();

      mockStorage.checkConnectivity.mockRejectedValue(new Error('now broken'));
      const second = await service.execute();

      expect(second.storageChecks).toEqual(first.storageChecks);
      expect(second.isHealthy()).toBe(true);
    });

    it('honours a custom TTL', async () => {
      configValues['HEALTH_STORAGE_CHECK_TTL_SECONDS'] = 60;

      await service.execute();
      currentTime = new Date(currentTime.getTime() + 61_000);
      await service.execute();

      expect(mockStorage.checkConnectivity).toHaveBeenCalledTimes(2);
    });

    it('still checks the audit DB on every call despite the storage cache', async () => {
      await service.execute();
      await service.execute();

      expect(mockAuditLog.findSince).toHaveBeenCalledTimes(2);
      expect(mockSystemHealth.checkDiskSpace).toHaveBeenCalledTimes(2);
    });
  });
});
