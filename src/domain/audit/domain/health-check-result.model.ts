export class HealthCheckResult {
  readonly auditDbConnected: boolean;
  readonly diskSpaceAvailable: boolean;
  readonly diskFreeGb: number;
  readonly sshConnected: boolean;
  readonly sshAuthenticated: boolean;
  readonly resticReposHealthy: boolean;
  readonly uptime: number;

  constructor(
    auditDbConnected: boolean,
    diskSpaceAvailable: boolean,
    diskFreeGb: number,
    sshConnected: boolean,
    sshAuthenticated: boolean,
    resticReposHealthy: boolean,
    uptime: number,
  ) {
    this.auditDbConnected = auditDbConnected;
    this.diskSpaceAvailable = diskSpaceAvailable;
    this.diskFreeGb = diskFreeGb;
    this.sshConnected = sshConnected;
    this.sshAuthenticated = sshAuthenticated;
    this.resticReposHealthy = resticReposHealthy;
    this.uptime = uptime;
  }

  isHealthy(): boolean {
    return (
      this.auditDbConnected &&
      this.diskSpaceAvailable &&
      this.sshConnected &&
      this.sshAuthenticated &&
      this.resticReposHealthy
    );
  }
}
