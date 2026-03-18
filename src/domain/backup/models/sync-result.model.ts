export class SyncResult {
  readonly snapshotId: string;
  readonly filesNew: number;
  readonly filesChanged: number;
  readonly bytesAdded: number;
  readonly durationMs: number;

  constructor(
    snapshotId: string,
    filesNew: number,
    filesChanged: number,
    bytesAdded: number,
    durationMs: number,
  ) {
    this.snapshotId = snapshotId;
    this.filesNew = filesNew;
    this.filesChanged = filesChanged;
    this.bytesAdded = bytesAdded;
    this.durationMs = durationMs;
  }
}
