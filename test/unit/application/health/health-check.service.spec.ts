import { ConfigService } from '@nestjs/config';
import { HealthCheckService } from '@application/health/health-check.service';
import { AuditLogPort } from '@domain/audit/ports/audit-log.port';
import * as childProcessUtil from '@shared/child-process.util';

jest.mock('@shared/child-process.util');

describe('HealthCheckService', () => {
  let service: HealthCheckService;
  let mockAuditLog: jest.Mocked<AuditLogPort>;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockSafeExecFile: jest.MockedFunction<typeof childProcessUtil.safeExecFile>;

  beforeEach(() => {
    mockAuditLog = {
      startRun: jest.fn(),
      trackProgress: jest.fn(),
      finishRun: jest.fn(),
      findByProject: jest.fn(),
      findFailed: jest.fn(),
      findSince: jest.fn(),
      findOrphaned: jest.fn(),
    };

    mockConfigService = {
      get: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;

    mockSafeExecFile = childProcessUtil.safeExecFile as jest.MockedFunction<
      typeof childProcessUtil.safeExecFile
    >;

    service = new HealthCheckService(
      mockAuditLog,
      mockConfigService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns healthy result when all checks pass', async () => {
    mockAuditLog.findSince.mockResolvedValue([]);
    mockConfigService.get.mockReturnValue(5);
    mockSafeExecFile.mockResolvedValue({ stdout: '  Avail\n    20G\n', stderr: '' });

    const result = await service.checkHealth();

    expect(result.auditDbConnected).toBe(true);
    expect(result.diskSpaceAvailable).toBe(true);
    expect(result.diskFreeGb).toBe(20);
    expect(result.sshConnected).toBe(true);
    expect(result.sshAuthenticated).toBe(true);
    expect(result.resticReposHealthy).toBe(true);
    expect(result.isHealthy()).toBe(true);
  });

  it('returns unhealthy when audit DB is down', async () => {
    mockAuditLog.findSince.mockRejectedValue(new Error('Connection refused'));
    mockConfigService.get.mockReturnValue(5);
    mockSafeExecFile.mockResolvedValue({ stdout: '  Avail\n    20G\n', stderr: '' });

    const result = await service.checkHealth();

    expect(result.auditDbConnected).toBe(false);
    expect(result.isHealthy()).toBe(false);
  });

  it('disk space check fails when below threshold', async () => {
    mockAuditLog.findSince.mockResolvedValue([]);
    mockConfigService.get.mockReturnValue(50);
    mockSafeExecFile.mockResolvedValue({ stdout: '  Avail\n    10G\n', stderr: '' });

    const result = await service.checkHealth();

    expect(result.diskSpaceAvailable).toBe(false);
    expect(result.diskFreeGb).toBe(10);
    expect(result.isHealthy()).toBe(false);
  });

  it('disk space check fails gracefully when df command errors', async () => {
    mockAuditLog.findSince.mockResolvedValue([]);
    mockConfigService.get.mockReturnValue(5);
    mockSafeExecFile.mockRejectedValue(new Error('df not found'));

    const result = await service.checkHealth();

    expect(result.diskSpaceAvailable).toBe(false);
    expect(result.diskFreeGb).toBe(0);
  });

  it('disk check passes when free space equals threshold', async () => {
    mockAuditLog.findSince.mockResolvedValue([]);
    mockConfigService.get.mockReturnValue(10);
    mockSafeExecFile.mockResolvedValue({ stdout: '  Avail\n    10G\n', stderr: '' });

    const result = await service.checkHealth();

    expect(result.diskSpaceAvailable).toBe(true);
    expect(result.diskFreeGb).toBe(10);
  });
});
