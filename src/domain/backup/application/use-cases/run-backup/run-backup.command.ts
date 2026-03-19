export class RunBackupCommand {
  public readonly projectName?: string;
  public readonly isAll: boolean;
  public readonly isDryRun: boolean;
  /** When true, lock is managed externally (e.g. by the scheduler) — skip acquire/release */
  public readonly lockHeldExternally: boolean;

  constructor(params: {
    projectName?: string;
    isAll?: boolean;
    isDryRun?: boolean;
    lockHeldExternally?: boolean;
  }) {
    this.projectName = params.projectName;
    this.isAll = params.isAll ?? false;
    this.isDryRun = params.isDryRun ?? false;
    this.lockHeldExternally = params.lockHeldExternally ?? false;
  }
}
