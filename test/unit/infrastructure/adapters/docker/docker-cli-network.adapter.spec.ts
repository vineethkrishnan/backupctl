import { DockerCliNetworkAdapter } from '@domain/network/infrastructure/adapters/docker-cli-network.adapter';
import * as childProcessUtil from '@common/helpers/child-process.util';

jest.mock('@common/helpers/child-process.util');

const mockSafeExecFile = childProcessUtil.safeExecFile as jest.MockedFunction<typeof childProcessUtil.safeExecFile>;

describe('DockerCliNetworkAdapter', () => {
  let adapter: DockerCliNetworkAdapter;

  beforeEach(() => {
    adapter = new DockerCliNetworkAdapter();
    jest.resetAllMocks();
  });

  describe('connectContainer', () => {
    it('calls docker network connect with correct args', async () => {
      mockSafeExecFile.mockResolvedValue({ stdout: '', stderr: '' });

      await adapter.connectContainer('backupctl', 'my-network');

      expect(mockSafeExecFile).toHaveBeenCalledWith(
        'docker',
        ['network', 'connect', 'my-network', 'backupctl'],
        { timeout: 30000 },
      );
    });

    it('propagates errors from docker command', async () => {
      mockSafeExecFile.mockRejectedValue(new Error('Command "docker" failed: permission denied'));

      await expect(adapter.connectContainer('backupctl', 'my-network')).rejects.toThrow('permission denied');
    });
  });

  describe('isContainerConnected', () => {
    it('returns true when network is in container inspect output', async () => {
      mockSafeExecFile.mockResolvedValue({
        stdout: JSON.stringify({
          'my-network': { NetworkID: 'abc123' },
          'other-network': { NetworkID: 'def456' },
        }),
        stderr: '',
      });

      const result = await adapter.isContainerConnected('backupctl', 'my-network');

      expect(result).toBe(true);
    });

    it('returns false when network is not in container inspect output', async () => {
      mockSafeExecFile.mockResolvedValue({
        stdout: JSON.stringify({
          'other-network': { NetworkID: 'def456' },
        }),
        stderr: '',
      });

      const result = await adapter.isContainerConnected('backupctl', 'my-network');

      expect(result).toBe(false);
    });
  });

  describe('networkExists', () => {
    it('returns true when docker network inspect succeeds', async () => {
      mockSafeExecFile.mockResolvedValue({ stdout: '[]', stderr: '' });

      const result = await adapter.networkExists('my-network');

      expect(result).toBe(true);
      expect(mockSafeExecFile).toHaveBeenCalledWith(
        'docker',
        ['network', 'inspect', 'my-network'],
        { timeout: 15000 },
      );
    });

    it('returns false when docker network inspect fails', async () => {
      mockSafeExecFile.mockRejectedValue(new Error('No such network'));

      const result = await adapter.networkExists('nonexistent');

      expect(result).toBe(false);
    });
  });
});
