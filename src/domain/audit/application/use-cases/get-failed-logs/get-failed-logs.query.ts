export class GetFailedLogsQuery {
  public readonly projectName: string;
  public readonly limit?: number;

  constructor(params: {
    projectName: string;
    limit?: number;
  }) {
    this.projectName = params.projectName;
    this.limit = params.limit;
  }
}
