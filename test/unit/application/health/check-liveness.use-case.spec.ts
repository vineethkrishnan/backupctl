import { ConfigService } from '@nestjs/config';
import { CheckLivenessUseCase } from '@domain/health/application/use-cases/check-liveness/check-liveness.use-case';
import { AuditLogPort } from '@domain/audit/application/ports/audit-log.port';
import { SystemHealthPort } from '@domain/health/application/ports/system-health.port';

describe('CheckLivenessUseCase', () => {
  let useCase: CheckLivenessUseCase;
  let mockAuditLog: jest.Mocked<AuditLogPort>;
  let mockSystemHealth: jest.Mocked<SystemHealthPort>;
  let configValues: Record<string, unknown>;

  beforeEach(() => {
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

    configValues = { HEALTH_DISK_MIN_FREE_GB: 5 };

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: unknown) => configValues[key] ?? defaultValue),
    } as unknown as ConfigService;

    useCase = new CheckLivenessUseCase(mockAuditLog, mockSystemHealth, mockConfigService);
  });

  it('is alive when the audit DB and disk are fine', async () => {
    const result = await useCase.execute();

    expect(result.auditDbConnected).toBe(true);
    expect(result.diskSpaceAvailable).toBe(true);
    expect(result.diskFreeGb).toBe(20);
    expect(result.isAlive()).toBe(true);
  });

  it('is not alive when the audit DB is down', async () => {
    mockAuditLog.findSince.mockRejectedValue(new Error('Connection refused'));

    const result = await useCase.execute();

    expect(result.auditDbConnected).toBe(false);
    expect(result.isAlive()).toBe(false);
  });

  it('is not alive when disk space is below the threshold', async () => {
    mockSystemHealth.checkDiskSpace.mockResolvedValue({ available: false, freeGb: 1 });

    const result = await useCase.execute();

    expect(result.isAlive()).toBe(false);
  });

  it('honours the configured disk threshold', async () => {
    configValues['HEALTH_DISK_MIN_FREE_GB'] = 10;

    await useCase.execute();

    expect(mockSystemHealth.checkDiskSpace).toHaveBeenCalledWith('/', 10);
  });
});
