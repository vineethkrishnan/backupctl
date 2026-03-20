import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { CheckHealthUseCase } from '@domain/health/application/use-cases/check-health/check-health.use-case';
import { HealthCheckResult } from '@domain/audit/domain/health-check-result.model';

interface HealthResponse {
  status: 'healthy' | 'unhealthy';
  checks: {
    auditDb: boolean;
    diskSpace: { available: boolean; freeGb: number };
    ssh: { connected: boolean; authenticated: boolean };
    resticRepos: boolean;
  };
  uptime: number;
}

@Controller('health')
export class HealthController {
  constructor(private readonly healthUseCase: CheckHealthUseCase) {}

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
        ssh: {
          connected: result.sshConnected,
          authenticated: result.sshAuthenticated,
        },
        resticRepos: result.resticReposHealthy,
      },
      uptime: result.uptime,
    };

    if (!result.isHealthy()) {
      throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    }

    return body;
  }
}
