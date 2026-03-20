import { SystemHealthAdapter } from '@domain/health/infrastructure/adapters/system-health.adapter';
import { safeExecFile } from '@common/helpers/child-process.util';

jest.mock('@common/helpers/child-process.util');

const mockedExec = safeExecFile as jest.MockedFunction<typeof safeExecFile>;

describe('SystemHealthAdapter', () => {
  let adapter: SystemHealthAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new SystemHealthAdapter();
  });

  // ── checkDiskSpace ─────────────────────────────────────────────────

  describe('checkDiskSpace', () => {
    it('parses POSIX df output and returns freeGb', async () => {
      mockedExec.mockResolvedValue({
        stdout: [
          'Filesystem     1K-blocks    Used Available Use% Mounted on',
          '/dev/sda1      51475068 8350000  40488068  18% /',
        ].join('\n'),
        stderr: '',
      });

      const result = await adapter.checkDiskSpace('/', 5);

      expect(result.available).toBe(true);
      expect(result.freeGb).toBeCloseTo(38.62, 1);
    });

    it('returns available=false when free space is below threshold', async () => {
      mockedExec.mockResolvedValue({
        stdout: [
          'Filesystem     1K-blocks    Used Available Use% Mounted on',
          '/dev/sda1      51475068 48000000   3475068   3% /',
        ].join('\n'),
        stderr: '',
      });

      const result = await adapter.checkDiskSpace('/', 5);

      expect(result.available).toBe(false);
      expect(result.freeGb).toBeCloseTo(3.31, 1);
    });

    it('handles BusyBox df output with different formatting', async () => {
      mockedExec.mockResolvedValue({
        stdout: [
          'Filesystem           1K-blocks      Used Available Use% Mounted on',
          'overlay               61255492  12640224  45473092  22% /',
        ].join('\n'),
        stderr: '',
      });

      const result = await adapter.checkDiskSpace('/', 5);

      expect(result.available).toBe(true);
      expect(result.freeGb).toBeGreaterThan(40);
    });

    it('returns available=false and freeGb=0 when df fails', async () => {
      mockedExec.mockRejectedValue(new Error('df: /nonexistent: No such file or directory'));

      const result = await adapter.checkDiskSpace('/nonexistent', 5);

      expect(result.available).toBe(false);
      expect(result.freeGb).toBe(0);
    });
  });

  // ── checkSshConnectivity ───────────────────────────────────────────

  describe('checkSshConnectivity', () => {
    const sshConfig = {
      host: 'storage.example.com',
      port: 23,
      user: 'u123456',
      keyPath: '/ssh-keys/id_ed25519',
    };

    it('returns true when SSH succeeds', async () => {
      mockedExec.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await adapter.checkSshConnectivity(sshConfig);

      expect(result).toBe(true);
      expect(mockedExec).toHaveBeenCalledWith(
        'ssh',
        expect.arrayContaining([
          '-i', '/ssh-keys/id_ed25519',
          '-p', '23',
          '-o', 'StrictHostKeyChecking=accept-new',
          '-o', 'ConnectTimeout=5',
          '-o', 'BatchMode=yes',
          'u123456@storage.example.com',
          'exit',
        ]),
        { timeout: 15000 },
      );
    });

    it('returns true when restricted shell rejects exit command', async () => {
      mockedExec.mockRejectedValue(new Error('Command not found'));

      const result = await adapter.checkSshConnectivity(sshConfig);

      expect(result).toBe(true);
    });

    it('returns false when SSH connection fails', async () => {
      mockedExec.mockRejectedValue(new Error('ssh: connect to host storage.example.com port 23: Connection refused'));

      const result = await adapter.checkSshConnectivity(sshConfig);

      expect(result).toBe(false);
    });

    it('returns false on timeout', async () => {
      mockedExec.mockRejectedValue(new Error('Command "ssh" failed: TIMEOUT'));

      const result = await adapter.checkSshConnectivity(sshConfig);

      expect(result).toBe(false);
    });
  });

  // ── checkSshAuthentication ─────────────────────────────────────────

  describe('checkSshAuthentication', () => {
    it('returns true for a valid key file', async () => {
      mockedExec.mockResolvedValue({
        stdout: '256 SHA256:abc123 user@host (ED25519)\n',
        stderr: '',
      });

      const result = await adapter.checkSshAuthentication('/ssh-keys/id_ed25519');

      expect(result).toBe(true);
      expect(mockedExec).toHaveBeenCalledWith(
        'ssh-keygen',
        ['-l', '-f', '/ssh-keys/id_ed25519'],
        { timeout: 5000 },
      );
    });

    it('returns false for an invalid/missing key file', async () => {
      mockedExec.mockRejectedValue(new Error('/ssh-keys/missing: No such file or directory'));

      const result = await adapter.checkSshAuthentication('/ssh-keys/missing');

      expect(result).toBe(false);
    });

    it('returns false when keyPath is empty', async () => {
      const result = await adapter.checkSshAuthentication('');

      expect(result).toBe(false);
      expect(mockedExec).not.toHaveBeenCalled();
    });
  });
});
