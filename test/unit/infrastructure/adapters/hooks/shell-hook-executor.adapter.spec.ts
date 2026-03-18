import { ShellHookExecutorAdapter } from '@infrastructure/adapters/hooks/shell-hook-executor.adapter';

jest.mock('@shared/child-process.util', () => ({
  safeExecFile: jest.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}));

import { safeExecFile } from '@shared/child-process.util';

const mockSafeExecFile = safeExecFile as jest.MockedFunction<typeof safeExecFile>;

describe('ShellHookExecutorAdapter', () => {
  let adapter: ShellHookExecutorAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new ShellHookExecutorAdapter();
  });

  it('should execute command via /bin/sh -c', async () => {
    const command = 'curl -s http://healthcheck.example.com/ping';

    await adapter.execute(command);

    expect(mockSafeExecFile).toHaveBeenCalledWith('/bin/sh', ['-c', command], {
      timeout: 60_000,
    });
  });

  it('should handle complex shell commands', async () => {
    const command = 'echo "backup started" && notify-send "Backup"';

    await adapter.execute(command);

    expect(mockSafeExecFile).toHaveBeenCalledWith('/bin/sh', ['-c', command], {
      timeout: 60_000,
    });
  });

  it('should throw on command failure', async () => {
    mockSafeExecFile.mockRejectedValueOnce(new Error('Command failed: exit code 1'));

    await expect(adapter.execute('false')).rejects.toThrow('Command failed');
  });
});
