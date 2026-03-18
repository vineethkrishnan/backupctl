import { Controller, Get } from '@nestjs/common';
import { HealthCheckService } from '@application/health/health-check.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthCheckService) {}

  @Get()
  async checkHealth() {
    const result = await this.healthService.checkHealth();

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
