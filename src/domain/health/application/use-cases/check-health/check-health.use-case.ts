import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditLogPort } from '@domain/audit/application/ports/audit-log.port';
import { HeartbeatMonitorPort } from '@domain/backup/application/ports/heartbeat-monitor.port';
import { RemoteStorageFactoryPort } from '@domain/backup/application/ports/remote-storage-factory.port';
import { ConfigLoaderPort } from '@domain/config/application/ports/config-loader.port';
import { ProjectConfig } from '@domain/config/domain/project-config.model';
import { SystemHealthPort } from '@domain/health/application/ports/system-health.port';
import { HealthCheckResult, StorageHealthCheck } from '@domain/audit/domain/health-check-result.model';
import { ClockPort } from '@common/clock/clock.port';
import {
  AUDIT_LOG_PORT,
  CLOCK_PORT,
  CONFIG_LOADER_PORT,
  HEARTBEAT_MONITOR_PORT,
  REMOTE_STORAGE_FACTORY,
  SYSTEM_HEALTH_PORT,
} from '@common/di/injection-tokens';

interface StorageCheckCache {
  readonly checkedAtMs: number;
  readonly checks: StorageHealthCheck[];
}

@Injectable()
export class CheckHealthUseCase {
  private readonly logger = new Logger(CheckHealthUseCase.name);

  private storageCache: StorageCheckCache | null = null;

  constructor(
    @Inject(AUDIT_LOG_PORT) private readonly auditLog: AuditLogPort,
    @Inject(SYSTEM_HEALTH_PORT) private readonly systemHealth: SystemHealthPort,
    @Inject(HEARTBEAT_MONITOR_PORT) private readonly heartbeatMonitor: HeartbeatMonitorPort,
    @Inject(CONFIG_LOADER_PORT) private readonly configLoader: ConfigLoaderPort,
    @Inject(REMOTE_STORAGE_FACTORY) private readonly storageFactory: RemoteStorageFactoryPort,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    private readonly configService: ConfigService,
  ) {}

  async execute(): Promise<HealthCheckResult> {
    const uptime = process.uptime();
    const minFreeGb = this.configService.get<number>('HEALTH_DISK_MIN_FREE_GB', 5);
    const isKumaConfigured = !!this.configService.get<string>('UPTIME_KUMA_BASE_URL');

    const [auditDbConnected, diskResult, storageChecks, kumaConnected] = await Promise.all([
      this.checkAuditDb(),
      this.systemHealth.checkDiskSpace('/', minFreeGb),
      this.checkStorageBackends(),
      isKumaConfigured ? this.heartbeatMonitor.checkConnectivity() : Promise.resolve(false),
    ]);

    return new HealthCheckResult({
      auditDbConnected,
      diskSpaceAvailable: diskResult.available,
      diskFreeGb: diskResult.freeGb,
      storageChecks,
      uptime,
      uptimeKumaConnected: kumaConnected,
      uptimeKumaConfigured: isKumaConfigured,
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

  /**
   * Cached because Docker's HEALTHCHECK polls /health every 30s: an uncached probe
   * would bill a restic round trip per project per poll against B2/Drive, and spawn
   * an `rclone serve restic` subprocess each time.
   */
  private async checkStorageBackends(): Promise<StorageHealthCheck[]> {
    const ttlSeconds = this.configService.get<number>('HEALTH_STORAGE_CHECK_TTL_SECONDS', 300);
    const nowMs = this.clock.now().getTime();

    if (this.storageCache && nowMs - this.storageCache.checkedAtMs < ttlSeconds * 1000) {
      return this.storageCache.checks;
    }

    const checks = await this.probeStorageBackends();
    this.storageCache = { checkedAtMs: nowMs, checks };

    return checks;
  }

  private async probeStorageBackends(): Promise<StorageHealthCheck[]> {
    let projects: ProjectConfig[];
    try {
      projects = this.configLoader.loadAll().filter((project) => project.enabled);
    } catch (error) {
      this.logger.error('Could not read project config for storage health check', error);
      return [];
    }

    return Promise.all(projects.map((project) => this.probeProject(project)));
  }

  private async probeProject(project: ProjectConfig): Promise<StorageHealthCheck> {
    const check = { project: project.name, backendType: project.storage.type };

    try {
      const storage = this.storageFactory.create(project);
      await storage.checkConnectivity();
      return { ...check, reachable: true, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Storage check failed for ${project.name}: ${message}`);
      return { ...check, reachable: false, error: message };
    }
  }
}
