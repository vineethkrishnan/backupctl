export type NetworkConnectStatus = 'connected' | 'already_connected' | 'skipped' | 'failed';

export class NetworkConnectResult {
  readonly projectName: string;
  readonly networkName: string;
  readonly status: NetworkConnectStatus;
  readonly message: string;

  constructor(params: {
    projectName: string;
    networkName: string;
    status: NetworkConnectStatus;
    message: string;
  }) {
    this.projectName = params.projectName;
    this.networkName = params.networkName;
    this.status = params.status;
    this.message = params.message;
  }
}
