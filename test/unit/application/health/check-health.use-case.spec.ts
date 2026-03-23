import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CheckHealthUseCase } from '@domain/health/application/use-cases/check-health/check-health.use-case';
import { AuditLogPort } from '@domain/audit/application/ports/audit-log.port';
import { SystemHealthPort } from '@domain/health/application/ports/system-health.port';
import { HeartbeatMonitorPort } from '@domain/backup/application/ports/heartbeat-monitor.port';
import {
  AUDIT_LOG_PORT,
  HEARTBEAT_MONITOR_PORT,
  SYSTEM_HEALTH_PORT,
} from '@common/di/injection-tokens';

describe('CheckHealthUseCase', () => {
  let service: CheckHealthUseCase;
  let mockAuditLog: jest.Mocked<AuditLogPort>;
  let mockSystemHealth: jest.Mocked<SystemHealthPort>;
  let mockHeartbeatMonitor: jest.Mocked<HeartbeatMonitorPort>;
  let configValues: Record<string, unknown>;

  beforeEach(async () => {
    mockAuditLog = {
      startRun: jest.fn(),
      trackProgress: jest.fn(),
      finishRun: jest.fn(),
      findByProject: jest.fn(),
      findFailed: jest.fn(),
      findSince: jest.fn(),
      findOrphaned: jest.fn(),
    };

    mockSystemHealth = {
      checkDiskSpace: jest.fn().mockResolvedValue({ available: true, freeGb: 20 }),
      checkSshConnectivity: jest.fn().mockResolvedValue(true),
      checkSshAuthentication: jest.fn().mockResolvedValue(true),
    };

    mockHeartbeatMonitor = {
      sendHeartbeat: jest.fn().mockResolvedValue(undefined),
      checkConnectivity: jest.fn().mockResolvedValue(true),
    };

    configValues = {
      HEALTH_DISK_MIN_FREE_GB: 5,
      HETZNER_SSH_HOST: 'storage.example.com',
      HETZNER_SSH_PORT: 23,
      HETZNER_SSH_USER: 'u123',
      HETZNER_SSH_KEY_PATH: '/home/node/.ssh/id_ed25519',
    };

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: unknown) => configValues[key] ?? defaultValue),
    } as unknown as ConfigService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CheckHealthUseCase,
        { provide: AUDIT_LOG_PORT, useValue: mockAuditLog },
        { provide: SYSTEM_HEALTH_PORT, useValue: mockSystemHealth },
        { provide: HEARTBEAT_MONITOR_PORT, useValue: mockHeartbeatMonitor },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get(CheckHealthUseCase);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns healthy result when all checks pass', async () => {
    mockAuditLog.findSince.mockResolvedValue([]);

    const result = await service.execute();

    expect(result.auditDbConnected).toBe(true);
    expect(result.diskSpaceAvailable).toBe(true);
    expect(result.diskFreeGb).toBe(20);
    expect(result.sshConnected).toBe(true);
    expect(result.sshAuthenticated).toBe(true);
    expect(result.isHealthy()).toBe(true);
    expect(mockHeartbeatMonitor.checkConnectivity).not.toHaveBeenCalled();
    expect(result.uptimeKumaConfigured).toBe(false);
    expect(result.uptimeKumaConnected).toBe(false);
  });

  it('calls checkConnectivity and sets uptimeKumaConfigured when UPTIME_KUMA_BASE_URL is set', async () => {
    configValues['UPTIME_KUMA_BASE_URL'] = 'https://kuma.example.com';
    mockAuditLog.findSince.mockResolvedValue([]);

    const result = await service.execute();

    expect(mockHeartbeatMonitor.checkConnectivity).toHaveBeenCalledTimes(1);
    expect(result.uptimeKumaConfigured).toBe(true);
    expect(result.uptimeKumaConnected).toBe(true);
  });

  it('does not call checkConnectivity when UPTIME_KUMA_BASE_URL is not set', async () => {
    mockAuditLog.findSince.mockResolvedValue([]);

    const result = await service.execute();

    expect(mockHeartbeatMonitor.checkConnectivity).not.toHaveBeenCalled();
    expect(result.uptimeKumaConfigured).toBe(false);
    expect(result.uptimeKumaConnected).toBe(false);
  });

  it('isHealthy() ignores Uptime Kuma when Kuma is unreachable but core checks pass', async () => {
    configValues['UPTIME_KUMA_BASE_URL'] = 'https://kuma.example.com';
    mockAuditLog.findSince.mockResolvedValue([]);
    mockHeartbeatMonitor.checkConnectivity.mockResolvedValue(false);

    const result = await service.execute();

    expect(result.uptimeKumaConfigured).toBe(true);
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
    mockAuditLog.findSince.mockResolvedValue([]);
    mockSystemHealth.checkDiskSpace.mockResolvedValue({ available: false, freeGb: 10 });

    const result = await service.execute();

    expect(result.diskSpaceAvailable).toBe(false);
    expect(result.diskFreeGb).toBe(10);
    expect(result.isHealthy()).toBe(false);
  });

  it('disk space check fails gracefully on adapter error', async () => {
    mockAuditLog.findSince.mockResolvedValue([]);
    mockSystemHealth.checkDiskSpace.mockResolvedValue({ available: false, freeGb: 0 });

    const result = await service.execute();

    expect(result.diskSpaceAvailable).toBe(false);
    expect(result.diskFreeGb).toBe(0);
  });

  it('disk check passes when free space equals threshold', async () => {
    configValues['HEALTH_DISK_MIN_FREE_GB'] = 10;
    mockAuditLog.findSince.mockResolvedValue([]);
    mockSystemHealth.checkDiskSpace.mockResolvedValue({ available: true, freeGb: 10 });

    const result = await service.execute();

    expect(result.diskSpaceAvailable).toBe(true);
    expect(result.diskFreeGb).toBe(10);
    expect(mockSystemHealth.checkDiskSpace).toHaveBeenCalledWith('/', 10);
  });

  it('SSH check skipped when HETZNER_SSH_HOST not configured', async () => {
    configValues['HETZNER_SSH_HOST'] = '';
    mockAuditLog.findSince.mockResolvedValue([]);

    const result = await service.execute();

    expect(result.sshConnected).toBe(false);
    expect(mockSystemHealth.checkSshConnectivity).not.toHaveBeenCalled();
  });

  it('SSH connectivity check fails when adapter returns false', async () => {
    mockAuditLog.findSince.mockResolvedValue([]);
    mockSystemHealth.checkSshConnectivity.mockResolvedValue(false);

    const result = await service.execute();

    expect(result.sshConnected).toBe(false);
  });

  it('SSH auth check fails when adapter returns false', async () => {
    mockAuditLog.findSince.mockResolvedValue([]);
    mockSystemHealth.checkSshAuthentication.mockResolvedValue(false);

    const result = await service.execute();

    expect(result.sshAuthenticated).toBe(false);
  });
});
