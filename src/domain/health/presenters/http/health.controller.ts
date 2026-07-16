import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { CheckHealthUseCase } from '@domain/health/application/use-cases/check-health/check-health.use-case';
import { CheckLivenessUseCase } from '@domain/health/application/use-cases/check-liveness/check-liveness.use-case';
import { HealthCheckResult } from '@domain/audit/domain/health-check-result.model';

interface HealthResponse {
  status: 'healthy' | 'unhealthy';
  checks: {
    auditDb: boolean;
    diskSpace: { available: boolean; freeGb: number };
    storage: Array<{ project: string; backendType: string; reachable: boolean; error?: string }>;
    uptimeKuma?: { configured: boolean; connected: boolean };
  };
  uptime: number;
}

interface LivenessResponse {
  status: 'healthy' | 'unhealthy';
  checks: {
    auditDb: boolean;
    diskSpace: { available: boolean; freeGb: number };
  };
  uptime: number;
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly healthUseCase: CheckHealthUseCase,
    private readonly livenessUseCase: CheckLivenessUseCase,
  ) {}

  /**
   * Backs the Docker HEALTHCHECK. Never touches remote storage — a container restart
   * cannot fix a remote outage, and a storage probe can outlast the healthcheck timeout.
   */
  @Get('live')
  async live(): Promise<LivenessResponse> {
    const result = await this.livenessUseCase.execute();

    const body: LivenessResponse = {
      status: result.isAlive() ? 'healthy' : 'unhealthy',
      checks: {
        auditDb: result.auditDbConnected,
        diskSpace: { available: result.diskSpaceAvailable, freeGb: result.diskFreeGb },
      },
      uptime: result.uptime,
    };

    if (!result.isAlive()) {
      throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    }

    return body;
  }

  @Get()
  async check(): Promise<HealthResponse> {
    const result: HealthCheckResult = await this.healthUseCase.execute();

    const body: HealthResponse = {
      status: result.isHealthy() ? 'healthy' : 'unhealthy',
      checks: {
        auditDb: result.auditDbConnected,
        diskSpace: {
          available: result.diskSpaceAvailable,
          freeGb: result.diskFreeGb,
        },
        storage: result.storageChecks.map((check) => ({
          project: check.project,
          backendType: check.backendType,
          reachable: check.reachable,
          ...(check.error ? { error: check.error } : {}),
        })),
        ...(result.uptimeKumaConfigured && {
          uptimeKuma: {
            configured: result.uptimeKumaConfigured,
            connected: result.uptimeKumaConnected,
          },
        }),
      },
      uptime: result.uptime,
    };

    if (!result.isHealthy()) {
      throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    }

    return body;
  }
}
