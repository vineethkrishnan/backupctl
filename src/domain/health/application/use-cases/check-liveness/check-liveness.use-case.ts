import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditLogPort } from '@domain/audit/application/ports/audit-log.port';
import { SystemHealthPort } from '@domain/health/application/ports/system-health.port';
import { LivenessResult } from '@domain/health/domain/liveness-result.model';
import { AUDIT_LOG_PORT, SYSTEM_HEALTH_PORT } from '@common/di/injection-tokens';

/**
 * Container-local health only. Deliberately excludes remote storage: this backs the
 * Docker HEALTHCHECK, and restarting the container cannot fix a Backblaze or Drive
 * outage. Remote reachability belongs to CheckHealthUseCase.
 */
@Injectable()
export class CheckLivenessUseCase {
  constructor(
    @Inject(AUDIT_LOG_PORT) private readonly auditLog: AuditLogPort,
    @Inject(SYSTEM_HEALTH_PORT) private readonly systemHealth: SystemHealthPort,
    private readonly configService: ConfigService,
  ) {}

  async execute(): Promise<LivenessResult> {
    const minFreeGb = this.configService.get<number>('HEALTH_DISK_MIN_FREE_GB', 5);

    const [auditDbConnected, diskResult] = await Promise.all([
      this.checkAuditDb(),
      this.systemHealth.checkDiskSpace('/', minFreeGb),
    ]);

    return new LivenessResult({
      auditDbConnected,
      diskSpaceAvailable: diskResult.available,
      diskFreeGb: diskResult.freeGb,
      uptime: process.uptime(),
    });
  }

  private async checkAuditDb(): Promise<boolean> {
    try {
      await this.auditLog.findSince(new Date());
      return true;
    } catch {
      return false;
    }
  }
}
