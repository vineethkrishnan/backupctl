export class RestoreBackupCommand {
  public readonly projectName: string;
  public readonly snapshotId: string;
  public readonly targetPath: string;
  public readonly only?: 'db' | 'assets';
  public readonly decompress: boolean;

  constructor(params: {
    projectName: string;
    snapshotId: string;
    targetPath: string;
    only?: 'db' | 'assets';
    decompress?: boolean;
  }) {
    this.projectName = params.projectName;
    this.snapshotId = params.snapshotId;
    this.targetPath = params.targetPath;
    this.only = params.only;
    this.decompress = params.decompress ?? false;
  }
}
