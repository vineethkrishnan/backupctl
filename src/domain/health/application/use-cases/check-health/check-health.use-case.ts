import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditLogPort } from '@domain/audit/application/ports/audit-log.port';
import { HealthCheckResult } from '@domain/audit/domain/health-check-result.model';
import { AUDIT_LOG_PORT } from '@common/di/injection-tokens';
import { safeExecFile } from '@common/helpers/child-process.util';

@Injectable()
export class CheckHealthUseCase {
  constructor(
    @Inject(AUDIT_LOG_PORT) private readonly auditLog: AuditLogPort,
    private readonly configService: ConfigService,
  ) {}

  async checkHealth(): Promise<HealthCheckResult> {
    const uptime = process.uptime();

    const auditDbConnected = await this.checkAuditDb();
    const { diskSpaceAvailable, diskFreeGb } = await this.checkDiskSpace();

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
