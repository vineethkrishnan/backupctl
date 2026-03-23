export interface HeartbeatMonitorPort {
  sendHeartbeat(
    pushToken: string,
    status: 'up' | 'down',
    message: string,
    durationMs: number,
  ): Promise<void>;

  checkConnectivity(): Promise<boolean>;
}
