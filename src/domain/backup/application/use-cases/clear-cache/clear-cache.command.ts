export class ClearCacheCommand {
  public readonly projectName?: string;
  public readonly clearAll: boolean;

  constructor(params: { projectName?: string; clearAll?: boolean }) {
    this.projectName = params.projectName;
    this.clearAll = params.clearAll ?? false;
  }
}
