export class RunBackupCommand {
  public readonly projectName?: string;
  public readonly isAll: boolean;
  public readonly isDryRun: boolean;

  constructor(params: {
    projectName?: string;
    isAll?: boolean;
    isDryRun?: boolean;
  }) {
    this.projectName = params.projectName;
    this.isAll = params.isAll ?? false;
    this.isDryRun = params.isDryRun ?? false;
  }
}
