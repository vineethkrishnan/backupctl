export class DumpResult {
  readonly filePath: string;
  readonly sizeBytes: number;
  readonly durationMs: number;

  constructor(filePath: string, sizeBytes: number, durationMs: number) {
    this.filePath = filePath;
    this.sizeBytes = sizeBytes;
    this.durationMs = durationMs;
  }
}
