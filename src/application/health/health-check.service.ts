import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditLogPort } from '@domain/audit/ports/audit-log.port';
import { HealthCheckResult } from '@domain/audit/models/health-check-result.model';
import { HealthUseCase } from '@domain/backup/ports/health.use-case';
import { AUDIT_LOG_PORT } from '@shared/injection-tokens';
import { safeExecFile } from '@shared/child-process.util';

@Injectable()
export class HealthCheckService implements HealthUseCase {
  constructor(
    @Inject(AUDIT_LOG_PORT) private readonly auditLog: AuditLogPort,
    private readonly configService: ConfigService,
  ) {}

  async checkHealth(): Promise<HealthCheckResult> {
    const uptime = process.uptime();

    // Check audit DB connectivity
    const auditDbConnected = await this.checkAuditDb();

    // Check disk space
    const { diskSpaceAvailable, diskFreeGb } = await this.checkDiskSpace();

    // SSH and restic checks — simplified stubs until adapters are ready
    const sshConnected = true;
    const sshAuthenticated = true;
    const resticReposHealthy = true;

    return new HealthCheckResult(
      auditDbConnected,
      diskSpaceAvailable,
      diskFreeGb,
      sshConnected,
      sshAuthenticated,
      resticReposHealthy,
      uptime,
    );
  }

  private async checkAuditDb(): Promise<boolean> {
    try {
      await this.auditLog.findSince(new Date());
      return true;
    } catch {
      return false;
    }
  }

  private async checkDiskSpace(): Promise<{ diskSpaceAvailable: boolean; diskFreeGb: number }> {
    const minFreeGb = this.configService.get<number>('HEALTH_DISK_MIN_FREE_GB', 5);

    try {
      const { stdout } = await safeExecFile('df', ['-BG', '--output=avail', '/']);
      const lines = stdout.trim().split('\n');
      const valueLine = lines[lines.length - 1].trim();
      const diskFreeGb = parseInt(valueLine.replace('G', ''), 10);

      return {
        diskSpaceAvailable: diskFreeGb >= minFreeGb,
        diskFreeGb,
      };
    } catch {
      return { diskSpaceAvailable: false, diskFreeGb: 0 };
    }
  }
}
