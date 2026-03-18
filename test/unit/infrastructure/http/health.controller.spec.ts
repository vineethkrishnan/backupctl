import { HealthController } from '@infrastructure/http/health.controller';
import { HealthCheckService } from '@application/health/health-check.service';
import { HealthCheckResult } from '@domain/audit/models/health-check-result.model';

describe('HealthController', () => {
  let controller: HealthController;
  let healthService: jest.Mocked<HealthCheckService>;

  beforeEach(() => {
    healthService = {
      checkHealth: jest.fn(),
    } as unknown as jest.Mocked<HealthCheckService>;

    controller = new HealthController(healthService);
  });

  it('should return healthy status when all checks pass', async () => {
    const healthyResult = new HealthCheckResult(true, true, 50, true, true, true, 3600);
    healthService.checkHealth.mockResolvedValue(healthyResult);

    const response = await controller.checkHealth();

    expect(response.status).toBe('healthy');
    expect(response.checks.auditDb).toBe(true);
    expect(response.checks.diskSpace.available).toBe(true);
    expect(response.checks.diskSpace.freeGb).toBe(50);
    expect(response.checks.ssh.connected).toBe(true);
    expect(response.checks.ssh.authenticated).toBe(true);
    expect(response.checks.resticRepos).toBe(true);
    expect(response.uptime).toBe(3600);
  });

  it('should return unhealthy status when audit DB is down', async () => {
    const unhealthyResult = new HealthCheckResult(false, true, 50, true, true, true, 3600);
    healthService.checkHealth.mockResolvedValue(unhealthyResult);

    const response = await controller.checkHealth();

    expect(response.status).toBe('unhealthy');
    expect(response.checks.auditDb).toBe(false);
  });

  it('should return unhealthy status when disk space is low', async () => {
    const unhealthyResult = new HealthCheckResult(true, false, 1, true, true, true, 3600);
    healthService.checkHealth.mockResolvedValue(unhealthyResult);

    const response = await controller.checkHealth();

    expect(response.status).toBe('unhealthy');
    expect(response.checks.diskSpace.available).toBe(false);
    expect(response.checks.diskSpace.freeGb).toBe(1);
  });

  it('should return unhealthy status when SSH is disconnected', async () => {
    const unhealthyResult = new HealthCheckResult(true, true, 50, false, false, true, 3600);
    healthService.checkHealth.mockResolvedValue(unhealthyResult);

    const response = await controller.checkHealth();

    expect(response.status).toBe('unhealthy');
    expect(response.checks.ssh.connected).toBe(false);
    expect(response.checks.ssh.authenticated).toBe(false);
  });

  it('should match expected response shape', async () => {
    const result = new HealthCheckResult(true, true, 25, true, true, true, 120);
    healthService.checkHealth.mockResolvedValue(result);

    const response = await controller.checkHealth();

    expect(response).toEqual({
      status: 'healthy',
      checks: {
        auditDb: true,
        diskSpace: { available: true, freeGb: 25 },
        ssh: { connected: true, authenticated: true },
        resticRepos: true,
      },
      uptime: 120,
    });
  });
});
