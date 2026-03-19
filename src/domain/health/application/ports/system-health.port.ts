export interface DiskSpaceResult {
  readonly available: boolean;
  readonly freeGb: number;
}

export interface SshCheckConfig {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly keyPath: string;
}

export interface SystemHealthPort {
  checkDiskSpace(path: string, minFreeGb: number): Promise<DiskSpaceResult>;
  checkSshConnectivity(config: SshCheckConfig): Promise<boolean>;
  checkSshAuthentication(keyPath: string): Promise<boolean>;
}
