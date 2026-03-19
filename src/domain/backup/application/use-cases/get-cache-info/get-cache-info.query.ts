export class GetCacheInfoQuery {
  public readonly projectName: string;

  constructor(params: { projectName: string }) {
    this.projectName = params.projectName;
  }
}
