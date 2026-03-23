export class HealthCheckResult {
  readonly auditDbConnected: boolean;
  readonly diskSpaceAvailable: boolean;
  readonly diskFreeGb: number;
  readonly sshConnected: boolean;
  readonly sshAuthenticated: boolean;
  readonly resticReposHealthy: boolean;
  readonly uptime: number;
  readonly sshConfigured: boolean;
  readonly uptimeKumaConnected: boolean;
  readonly uptimeKumaConfigured: boolean;

  constructor(
    auditDbConnected: boolean,
    diskSpaceAvailable: boolean,
    diskFreeGb: number,
    sshConnected: boolean,
    sshAuthenticated: boolean,
    resticReposHealthy: boolean,
    uptime: number,
    sshConfigured = true,
    uptimeKumaConnected = false,
    uptimeKumaConfigured = false,
  ) {
    this.auditDbConnected = auditDbConnected;
    this.diskSpaceAvailable = diskSpaceAvailable;
    this.diskFreeGb = diskFreeGb;
    this.sshConnected = sshConnected;
    this.sshAuthenticated = sshAuthenticated;
    this.resticReposHealthy = resticReposHealthy;
    this.uptime = uptime;
    this.sshConfigured = sshConfigured;
    this.uptimeKumaConnected = uptimeKumaConnected;
    this.uptimeKumaConfigured = uptimeKumaConfigured;
  }

  isHealthy(): boolean {
    const coreHealthy = this.auditDbConnected && this.diskSpaceAvailable;

    if (!this.sshConfigured) {
      return coreHealthy;
    }

    return coreHealthy && this.sshConnected && this.sshAuthenticated && this.resticReposHealthy;
  }
}
