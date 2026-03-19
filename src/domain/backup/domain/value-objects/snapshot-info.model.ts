export class SnapshotInfo {
  readonly id: string;
  readonly time: string;
  readonly paths: readonly string[];
  readonly hostname: string;
  readonly tags: readonly string[];
  readonly size: string;

  constructor(
    id: string,
    time: string,
    paths: readonly string[],
    hostname: string,
    tags: readonly string[],
    size: string,
  ) {
    this.id = id;
    this.time = time;
    this.paths = paths;
    this.hostname = hostname;
    this.tags = tags;
    this.size = size;
  }
}
