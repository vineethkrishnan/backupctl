import { Command, CommandRunner } from 'nest-commander';

import { HealthCheckService } from '@application/health/health-check.service';
import { formatDuration } from '@shared/format.util';

@Command({
  name: 'health',
  description: 'Check health of all backupctl components',
})
export class HealthCommand extends CommandRunner {
  constructor(
    private readonly healthCheck: HealthCheckService,
  ) {
    super();
  }

  async run(_params: string[]): Promise<void> {
    try {
      const result = await this.healthCheck.checkHealth();
      const isHealthy = result.isHealthy();

      console.log(isHealthy ? 'System healthy' : 'System unhealthy');
      console.log('');
      this.printCheck('Audit DB', result.auditDbConnected);
      this.printCheck('Disk space', result.diskSpaceAvailable, `${result.diskFreeGb} GB free`);
      this.printCheck('SSH connection', result.sshConnected);
      this.printCheck('SSH auth', result.sshAuthenticated);
      this.printCheck('Restic repos', result.resticReposHealthy);
      console.log(`  Uptime: ${formatDuration(result.uptime * 1000)}`);

      if (!isHealthy) {
        process.exitCode = 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      process.exitCode = 1;
    }
  }

  private printCheck(label: string, passed: boolean, detail?: string): void {
    const icon = passed ? '✓' : '✗';
    const suffix = detail ? ` (${detail})` : '';
    console.log(`  ${icon} ${label}${suffix}`);
  }
}
