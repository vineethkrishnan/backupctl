export class CleanupResult {
  readonly filesRemoved: number;
  readonly spaceFreed: number;

  constructor(filesRemoved: number, spaceFreed: number) {
    this.filesRemoved = filesRemoved;
    this.spaceFreed = spaceFreed;
  }
}
