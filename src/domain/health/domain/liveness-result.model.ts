export interface LivenessResultParams {
  readonly auditDbConnected: boolean;
  readonly diskSpaceAvailable: boolean;
  readonly diskFreeGb: number;
  readonly uptime: number;
}

export class LivenessResult {
  readonly auditDbConnected: boolean;
  readonly diskSpaceAvailable: boolean;
  readonly diskFreeGb: number;
  readonly uptime: number;

  constructor(params: LivenessResultParams) {
    this.auditDbConnected = params.auditDbConnected;
    this.diskSpaceAvailable = params.diskSpaceAvailable;
    this.diskFreeGb = params.diskFreeGb;
    this.uptime = params.uptime;
  }

  isAlive(): boolean {
    return this.auditDbConnected && this.diskSpaceAvailable;
  }
}
