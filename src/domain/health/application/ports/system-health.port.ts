export interface DiskSpaceResult {
  readonly available: boolean;
  readonly freeGb: number;
}

export interface SystemHealthPort {
  checkDiskSpace(path: string, minFreeGb: number): Promise<DiskSpaceResult>;
}
