import { HealthController } from '@domain/health/presenters/http/health.controller';
import { CheckHealthUseCase } from '@domain/health/application/use-cases/check-health/check-health.use-case';
import { HealthCheckResult } from '@domain/audit/domain/health-check-result.model';

describe('HealthController', () => {
  let controller: HealthController;
  let checkHealth: jest.Mocked<CheckHealthUseCase>;

  beforeEach(() => {
    checkHealth = {
      checkHealth: jest.fn(),
    } as unknown as jest.Mocked<CheckHealthUseCase>;

    controller = new HealthController(checkHealth);
  });

  it('should return healthy status when all checks pass', async () => {
    const healthyResult = new HealthCheckResult(true, true, 50, true, true, true, 3600);
    checkHealth.checkHealth.mockResolvedValue(healthyResult);

    const response = await controller.check();

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
    checkHealth.checkHealth.mockResolvedValue(unhealthyResult);

    const response = await controller.check();

    expect(response.status).toBe('unhealthy');
    expect(response.checks.auditDb).toBe(false);
  });

  it('should return unhealthy status when disk space is low', async () => {
    const unhealthyResult = new HealthCheckResult(true, false, 1, true, true, true, 3600);
    checkHealth.checkHealth.mockResolvedValue(unhealthyResult);

    const response = await controller.check();

    expect(response.status).toBe('unhealthy');
    expect(response.checks.diskSpace.available).toBe(false);
    expect(response.checks.diskSpace.freeGb).toBe(1);
  });

  it('should return unhealthy status when SSH is disconnected', async () => {
    const unhealthyResult = new HealthCheckResult(true, true, 50, false, false, true, 3600);
    checkHealth.checkHealth.mockResolvedValue(unhealthyResult);

    const response = await controller.check();

    expect(response.status).toBe('unhealthy');
    expect(response.checks.ssh.connected).toBe(false);
    expect(response.checks.ssh.authenticated).toBe(false);
  });

  it('should match expected response shape', async () => {
    const result = new HealthCheckResult(true, true, 25, true, true, true, 120);
    checkHealth.checkHealth.mockResolvedValue(result);

    const response = await controller.check();

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
