import { HttpException, HttpStatus } from '@nestjs/common';
import { HealthController } from '@domain/health/presenters/http/health.controller';
import { CheckHealthUseCase } from '@domain/health/application/use-cases/check-health/check-health.use-case';
import { HealthCheckResult } from '@domain/audit/domain/health-check-result.model';

describe('HealthController', () => {
  let controller: HealthController;
  let checkHealth: jest.Mocked<CheckHealthUseCase>;

  beforeEach(() => {
    checkHealth = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<CheckHealthUseCase>;

    controller = new HealthController(checkHealth);
  });

  it('should return healthy response when all checks pass', async () => {
    const healthyResult = new HealthCheckResult(true, true, 50, true, true, true, 3600);
    checkHealth.execute.mockResolvedValue(healthyResult);

    const body = await controller.check();

    expect(body.status).toBe('healthy');
    expect(body.checks.auditDb).toBe(true);
    expect(body.checks.diskSpace.available).toBe(true);
    expect(body.checks.diskSpace.freeGb).toBe(50);
    expect(body.checks.ssh.connected).toBe(true);
    expect(body.checks.ssh.authenticated).toBe(true);
    expect(body.checks.resticRepos).toBe(true);
    expect(body.uptime).toBe(3600);
  });

  it('should throw 503 HttpException when audit DB is down', async () => {
    const unhealthyResult = new HealthCheckResult(false, true, 50, true, true, true, 3600);
    checkHealth.execute.mockResolvedValue(unhealthyResult);

    try {
      await controller.check();
      fail('Expected HttpException to be thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const exception = error as HttpException;
      expect(exception.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      const response = exception.getResponse() as Record<string, unknown>;
      expect(response.status).toBe('unhealthy');
    }
  });

  it('should throw 503 HttpException when disk space is low', async () => {
    const unhealthyResult = new HealthCheckResult(true, false, 1, true, true, true, 3600);
    checkHealth.execute.mockResolvedValue(unhealthyResult);

    try {
      await controller.check();
      fail('Expected HttpException to be thrown');
    } catch (error) {
      const exception = error as HttpException;
      expect(exception.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      const response = exception.getResponse() as Record<string, unknown>;
      const checks = response.checks as Record<string, unknown>;
      const diskSpace = checks.diskSpace as Record<string, unknown>;
      expect(diskSpace.available).toBe(false);
      expect(diskSpace.freeGb).toBe(1);
    }
  });

  it('should throw 503 HttpException when SSH is disconnected', async () => {
    const unhealthyResult = new HealthCheckResult(true, true, 50, false, false, true, 3600);
    checkHealth.execute.mockResolvedValue(unhealthyResult);

    try {
      await controller.check();
      fail('Expected HttpException to be thrown');
    } catch (error) {
      const exception = error as HttpException;
      expect(exception.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      const response = exception.getResponse() as Record<string, unknown>;
      const checks = response.checks as Record<string, unknown>;
      const ssh = checks.ssh as Record<string, unknown>;
      expect(ssh.connected).toBe(false);
      expect(ssh.authenticated).toBe(false);
    }
  });

  it('should match expected response shape', async () => {
    const result = new HealthCheckResult(true, true, 25, true, true, true, 120);
    checkHealth.execute.mockResolvedValue(result);

    const body = await controller.check();

    expect(body).toEqual({
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
