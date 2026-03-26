import { NetworkCommand, NetworkConnectSubCommand } from '@domain/network/presenters/cli/network.command';
import { ConnectNetworkUseCase } from '@domain/network/application/use-cases/connect-network/connect-network.use-case';
import { NetworkConnectResult } from '@domain/network/domain/network-connect-result.model';

describe('NetworkConnectSubCommand', () => {
  let command: NetworkConnectSubCommand;
  let connectNetwork: jest.Mocked<ConnectNetworkUseCase>;

  beforeEach(() => {
    connectNetwork = { execute: jest.fn() } as unknown as jest.Mocked<ConnectNetworkUseCase>;
    command = new NetworkConnectSubCommand(connectNetwork);
    process.exitCode = undefined;
    jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('connects a specific project when name is provided', async () => {
    connectNetwork.execute.mockResolvedValue([
      new NetworkConnectResult({ projectName: 'my-project', networkName: 'my-net', status: 'connected', message: 'connected to my-net' }),
    ]);

    await command.run(['my-project']);

    expect(connectNetwork.execute).toHaveBeenCalledWith(
      expect.objectContaining({ projectName: 'my-project' }),
    );
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('my-project'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('1 connected'));
  });

  it('connects all projects when no name is provided', async () => {
    connectNetwork.execute.mockResolvedValue([
      new NetworkConnectResult({ projectName: 'proj-a', networkName: 'net-a', status: 'connected', message: 'connected to net-a' }),
      new NetworkConnectResult({ projectName: 'proj-b', networkName: 'net-b', status: 'already_connected', message: 'already connected to net-b' }),
    ]);

    await command.run([]);

    expect(connectNetwork.execute).toHaveBeenCalledWith(
      expect.objectContaining({ projectName: undefined }),
    );
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('1 connected'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('1 already connected'));
  });

  it('sets exit code 1 when all results fail', async () => {
    connectNetwork.execute.mockResolvedValue([
      new NetworkConnectResult({ projectName: 'proj', networkName: 'net', status: 'failed', message: 'network not found' }),
    ]);

    await command.run([]);

    expect(process.exitCode).toBe(1);
  });

  it('sets exit code 5 for partial failure', async () => {
    connectNetwork.execute.mockResolvedValue([
      new NetworkConnectResult({ projectName: 'proj-a', networkName: 'net-a', status: 'connected', message: 'connected' }),
      new NetworkConnectResult({ projectName: 'proj-b', networkName: 'net-b', status: 'failed', message: 'failed' }),
    ]);

    await command.run([]);

    expect(process.exitCode).toBe(5);
  });

  it('does not set exit code on full success', async () => {
    connectNetwork.execute.mockResolvedValue([
      new NetworkConnectResult({ projectName: 'proj', networkName: 'net', status: 'connected', message: 'connected' }),
    ]);

    await command.run([]);

    expect(process.exitCode).toBeUndefined();
  });

  it('includes skipped in summary', async () => {
    connectNetwork.execute.mockResolvedValue([
      new NetworkConnectResult({ projectName: 'proj', networkName: '', status: 'skipped', message: 'no docker_network configured' }),
    ]);

    await command.run([]);

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('1 skipped'));
  });
});

describe('NetworkCommand', () => {
  it('prints usage info', async () => {
    const command = new NetworkCommand();
    jest.spyOn(console, 'log').mockImplementation();

    await command.run();

    expect(console.log).toHaveBeenCalledWith('Usage: backupctl network <connect>');
    jest.restoreAllMocks();
  });
});
