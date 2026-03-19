export class CacheInfo {
  readonly projectName: string;
  readonly cacheSizeBytes: number;
  readonly cachePath: string;

  constructor(projectName: string, cacheSizeBytes: number, cachePath: string) {
    this.projectName = projectName;
    this.cacheSizeBytes = cacheSizeBytes;
    this.cachePath = cachePath;
  }
}
