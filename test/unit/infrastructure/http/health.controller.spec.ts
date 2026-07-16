import { HttpException, HttpStatus } from '@nestjs/common';
import { HealthController } from '@domain/health/presenters/http/health.controller';
import { CheckHealthUseCase } from '@domain/health/application/use-cases/check-health/check-health.use-case';
import { CheckLivenessUseCase } from '@domain/health/application/use-cases/check-liveness/check-liveness.use-case';
import { LivenessResult } from '@domain/health/domain/liveness-result.model';
import { buildHealthCheckResult, buildStorageHealthCheck } from '@test/support/health-check-result.builder';

describe('HealthController', () => {
  let controller: HealthController;
  let checkHealth: jest.Mocked<CheckHealthUseCase>;
  let checkLiveness: jest.Mocked<CheckLivenessUseCase>;

  beforeEach(() => {
    checkHealth = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<CheckHealthUseCase>;

    checkLiveness = {
      execute: jest.fn().mockResolvedValue(
        new LivenessResult({
          auditDbConnected: true,
          diskSpaceAvailable: true,
          diskFreeGb: 50,
          uptime: 3600,
        }),
      ),
    } as unknown as jest.Mocked<CheckLivenessUseCase>;

    controller = new HealthController(checkHealth, checkLiveness);
  });

  describe('GET /health/live', () => {
    it('returns healthy without probing remote storage', async () => {
      const body = await controller.live();

      expect(body).toEqual({
        status: 'healthy',
        checks: { auditDb: true, diskSpace: { available: true, freeGb: 50 } },
        uptime: 3600,
      });
      expect(checkHealth.execute).not.toHaveBeenCalled();
    });

    it('stays healthy when a storage backend is down, so Docker will not restart the container', async () => {
      checkHealth.execute.mockResolvedValue(
        buildHealthCheckResult({
          storageChecks: [buildStorageHealthCheck({ reachable: false, error: 'B2 outage' })],
        }),
      );

      const body = await controller.live();

      expect(body.status).toBe('healthy');
      expect(checkHealth.execute).not.toHaveBeenCalled();
    });

    it('returns 503 when the audit DB is down', async () => {
      checkLiveness.execute.mockResolvedValue(
        new LivenessResult({
          auditDbConnected: false,
          diskSpaceAvailable: true,
          diskFreeGb: 50,
          uptime: 3600,
        }),
      );

      await expect(controller.live()).rejects.toThrow(HttpException);
    });

    it('returns 503 when disk space is low', async () => {
      checkLiveness.execute.mockResolvedValue(
        new LivenessResult({
          auditDbConnected: true,
          diskSpaceAvailable: false,
          diskFreeGb: 1,
          uptime: 3600,
        }),
      );

      try {
        await controller.live();
        fail('Expected HttpException to be thrown');
      } catch (error) {
        expect((error as HttpException).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      }
    });
  });

  it('should return healthy response when all checks pass', async () => {
    checkHealth.execute.mockResolvedValue(buildHealthCheckResult());

    const body = await controller.check();

    expect(body.status).toBe('healthy');
    expect(body.checks.auditDb).toBe(true);
    expect(body.checks.diskSpace.available).toBe(true);
    expect(body.checks.diskSpace.freeGb).toBe(50);
    expect(body.checks.storage).toEqual([
      { project: 'vinelab', backendType: 'sftp', reachable: true },
    ]);
    expect(body.uptime).toBe(3600);
  });

  it('should throw 503 HttpException when audit DB is down', async () => {
    checkHealth.execute.mockResolvedValue(buildHealthCheckResult({ auditDbConnected: false }));

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
    checkHealth.execute.mockResolvedValue(
      buildHealthCheckResult({ diskSpaceAvailable: false, diskFreeGb: 1 }),
    );

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

  it('should throw 503 HttpException when a storage backend is unreachable', async () => {
    checkHealth.execute.mockResolvedValue(
      buildHealthCheckResult({
        storageChecks: [
          buildStorageHealthCheck({
            project: 'vinelab',
            backendType: 's3',
            reachable: false,
            error: 'Fatal: unable to open config file',
          }),
        ],
      }),
    );

    try {
      await controller.check();
      fail('Expected HttpException to be thrown');
    } catch (error) {
      const exception = error as HttpException;
      expect(exception.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      const response = exception.getResponse() as Record<string, unknown>;
      const checks = response.checks as Record<string, unknown>;
      expect(checks.storage).toEqual([
        {
          project: 'vinelab',
          backendType: 's3',
          reachable: false,
          error: 'Fatal: unable to open config file',
        },
      ]);
    }
  });

  it('should report healthy when no projects are configured', async () => {
    checkHealth.execute.mockResolvedValue(buildHealthCheckResult({ storageChecks: [] }));

    const body = await controller.check();

    expect(body.status).toBe('healthy');
    expect(body.checks.storage).toEqual([]);
  });

  it('should report per-project results for mixed backends', async () => {
    checkHealth.execute.mockResolvedValue(
      buildHealthCheckResult({
        storageChecks: [
          buildStorageHealthCheck({ project: 'a', backendType: 's3', reachable: true }),
          buildStorageHealthCheck({ project: 'b', backendType: 'rclone', reachable: false, error: 'token expired' }),
        ],
      }),
    );

    try {
      await controller.check();
      fail('Expected HttpException to be thrown');
    } catch (error) {
      const response = (error as HttpException).getResponse() as Record<string, unknown>;
      const checks = response.checks as Record<string, unknown>;
      expect(checks.storage).toEqual([
        { project: 'a', backendType: 's3', reachable: true },
        { project: 'b', backendType: 'rclone', reachable: false, error: 'token expired' },
      ]);
    }
  });

  it('should match expected response shape', async () => {
    checkHealth.execute.mockResolvedValue(buildHealthCheckResult({ diskFreeGb: 25, uptime: 120 }));

    const body = await controller.check();

    expect(body).toEqual({
      status: 'healthy',
      checks: {
        auditDb: true,
        diskSpace: { available: true, freeGb: 25 },
        storage: [{ project: 'vinelab', backendType: 'sftp', reachable: true }],
      },
      uptime: 120,
    });
  });

  it('should include uptimeKuma in response when configured', async () => {
    checkHealth.execute.mockResolvedValue(
      buildHealthCheckResult({ uptimeKumaConfigured: true, uptimeKumaConnected: true }),
    );

    const body = await controller.check();

    expect(body.checks.uptimeKuma).toEqual({ configured: true, connected: true });
    expect(body.status).toBe('healthy');
  });

  it('should include uptimeKuma when configured but disconnected without affecting healthy status', async () => {
    checkHealth.execute.mockResolvedValue(
      buildHealthCheckResult({ uptimeKumaConfigured: true, uptimeKumaConnected: false }),
    );

    const body = await controller.check();

    expect(body.checks.uptimeKuma).toEqual({ configured: true, connected: false });
    expect(body.status).toBe('healthy');
  });
});
