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
});
