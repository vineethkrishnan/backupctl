import { NetworkConnectResult } from '@domain/network/domain/network-connect-result.model';

describe('NetworkConnectResult', () => {
  it('should construct with all fields', () => {
    const result = new NetworkConnectResult({
      projectName: 'my-project',
      networkName: 'my-network',
      status: 'connected',
      message: 'connected to my-network',
    });

    expect(result.projectName).toBe('my-project');
    expect(result.networkName).toBe('my-network');
    expect(result.status).toBe('connected');
    expect(result.message).toBe('connected to my-network');
  });

  it('should accept already_connected status', () => {
    const result = new NetworkConnectResult({
      projectName: 'proj',
      networkName: 'net',
      status: 'already_connected',
      message: 'already connected to net',
    });

    expect(result.status).toBe('already_connected');
  });

  it('should accept skipped status with empty network name', () => {
    const result = new NetworkConnectResult({
      projectName: 'proj',
      networkName: '',
      status: 'skipped',
      message: 'no docker_network configured',
    });

    expect(result.status).toBe('skipped');
    expect(result.networkName).toBe('');
  });

  it('should accept failed status', () => {
    const result = new NetworkConnectResult({
      projectName: 'proj',
      networkName: 'bad-net',
      status: 'failed',
      message: "network 'bad-net' does not exist",
    });

    expect(result.status).toBe('failed');
  });
});
