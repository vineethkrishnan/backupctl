export interface StorageHealthCheck {
  readonly project: string;
  readonly backendType: string;
  readonly reachable: boolean;
  readonly error: string | null;
}

export interface HealthCheckResultParams {
  readonly auditDbConnected: boolean;
  readonly diskSpaceAvailable: boolean;
  readonly diskFreeGb: number;
  readonly storageChecks: readonly StorageHealthCheck[];
  readonly uptime: number;
  readonly uptimeKumaConnected?: boolean;
  readonly uptimeKumaConfigured?: boolean;
}

export class HealthCheckResult {
  readonly auditDbConnected: boolean;
  readonly diskSpaceAvailable: boolean;
  readonly diskFreeGb: number;
  readonly storageChecks: readonly StorageHealthCheck[];
  readonly uptime: number;
  readonly uptimeKumaConnected: boolean;
  readonly uptimeKumaConfigured: boolean;

  constructor(params: HealthCheckResultParams) {
    this.auditDbConnected = params.auditDbConnected;
    this.diskSpaceAvailable = params.diskSpaceAvailable;
    this.diskFreeGb = params.diskFreeGb;
    this.storageChecks = params.storageChecks;
    this.uptime = params.uptime;
    this.uptimeKumaConnected = params.uptimeKumaConnected ?? false;
    this.uptimeKumaConfigured = params.uptimeKumaConfigured ?? false;
  }

  storageHealthy(): boolean {
    return this.storageChecks.every((check) => check.reachable);
  }

  isHealthy(): boolean {
    return this.auditDbConnected && this.diskSpaceAvailable && this.storageHealthy();
  }
}
