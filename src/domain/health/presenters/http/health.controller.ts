import { Controller, Get } from '@nestjs/common';
import { CheckHealthUseCase } from '@domain/health/application/use-cases/check-health/check-health.use-case';

@Controller('health')
export class HealthController {
  constructor(private readonly checkHealth: CheckHealthUseCase) {}

  @Get()
  async check() {
    const result = await this.checkHealth.checkHealth();

    return {
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
  }
}
