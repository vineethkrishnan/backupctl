export class PruneBackupCommand {
  public readonly projectName?: string;
  public readonly isAll: boolean;

  constructor(params: {
    projectName?: string;
    isAll?: boolean;
  }) {
    this.projectName = params.projectName;
    this.isAll = params.isAll ?? false;
  }
}
