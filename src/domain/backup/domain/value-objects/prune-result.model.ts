export class PruneResult {
  readonly snapshotsRemoved: number;
  readonly spaceFreed: string;

  constructor(snapshotsRemoved: number, spaceFreed: string) {
    this.snapshotsRemoved = snapshotsRemoved;
    this.spaceFreed = spaceFreed;
  }
}
