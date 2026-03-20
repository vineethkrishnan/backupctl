import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditLogPort } from '@domain/audit/application/ports/audit-log.port';
import { SystemHealthPort, SshCheckConfig } from '@domain/health/application/ports/system-health.port';
import { HealthCheckResult } from '@domain/audit/domain/health-check-result.model';
import { AUDIT_LOG_PORT, SYSTEM_HEALTH_PORT } from '@common/di/injection-tokens';

@Injectable()
export class CheckHealthUseCase {
  constructor(
    @Inject(AUDIT_LOG_PORT) private readonly auditLog: AuditLogPort,
    @Inject(SYSTEM_HEALTH_PORT) private readonly systemHealth: SystemHealthPort,
    private readonly configService: ConfigService,
  ) {}

  async execute(): Promise<HealthCheckResult> {
    const uptime = process.uptime();
    const minFreeGb = this.configService.get<number>('HEALTH_DISK_MIN_FREE_GB', 5);
    const sshConfig = this.buildSshConfig();

    const [auditDbConnected, diskResult, sshConnected, sshAuthenticated] =
      await Promise.all([
        this.checkAuditDb(),
        this.systemHealth.checkDiskSpace('/', minFreeGb),
        sshConfig ? this.systemHealth.checkSshConnectivity(sshConfig) : Promise.resolve(false),
        sshConfig?.keyPath ? this.systemHealth.checkSshAuthentication(sshConfig.keyPath) : Promise.resolve(false),
      ]);

    const isSshConfigured = sshConfig !== null;

    return new HealthCheckResult(
      auditDbConnected,
      diskResult.available,
      diskResult.freeGb,
      sshConnected,
      sshAuthenticated,
      sshConnected && sshAuthenticated,
      uptime,
      isSshConfigured,
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

  private buildSshConfig(): SshCheckConfig | null {
    const host = this.configService.get<string>('HETZNER_SSH_HOST', '');
    if (!host) return null;

    return {
      host,
      port: this.configService.get<number>('HETZNER_SSH_PORT', 22),
      user: this.configService.get<string>('HETZNER_SSH_USER', ''),
      keyPath: this.configService.get<string>('HETZNER_SSH_KEY_PATH', ''),
    };
  }
}
