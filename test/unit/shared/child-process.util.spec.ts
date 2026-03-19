import { execFile } from 'child_process';
import { safeExecFile } from '@common/helpers/child-process.util';

jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

const execFileMock = execFile as unknown as jest.Mock;

function mockExecFileSuccess(stdout: string, stderr: string) {
  execFileMock.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, callback: Function) => {
      callback(null, stdout, stderr);
    },
  );
}

function mockExecFileFailure(error: Error) {
  execFileMock.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, callback: Function) => {
      callback(error);
    },
  );
}

describe('safeExecFile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should resolve with stdout and stderr on success', async () => {
    mockExecFileSuccess('output data', 'warning info');

    const result = await safeExecFile('pg_dump', ['--format=custom', 'mydb']);

    expect(result.stdout).toBe('output data');
    expect(result.stderr).toBe('warning info');
  });

  it('should pass timeout option to execFile (default 30000ms)', async () => {
    mockExecFileSuccess('', '');

    await safeExecFile('restic', ['backup', '/data']);

    const callOptions = execFileMock.mock.calls[0][2];
    expect(callOptions.timeout).toBe(30000);
  });

  it('should use custom timeout when provided', async () => {
    mockExecFileSuccess('', '');

    await safeExecFile('restic', ['backup'], { timeout: 60000 });

    const callOptions = execFileMock.mock.calls[0][2];
    expect(callOptions.timeout).toBe(60000);
  });

  it('should reject with descriptive error including command name', async () => {
    mockExecFileFailure(new Error('spawn ENOENT'));

    await expect(safeExecFile('pg_dump', ['mydb'])).rejects.toThrow(
      'Command "pg_dump mydb" failed: spawn ENOENT',
    );
  });

  it('should pass custom env vars merged with process.env', async () => {
    mockExecFileSuccess('', '');

    await safeExecFile('restic', ['snapshots'], {
      env: { RESTIC_PASSWORD: 'secret123' },
    });

    const callOptions = execFileMock.mock.calls[0][2];
    expect(callOptions.env).toEqual(
      expect.objectContaining({ RESTIC_PASSWORD: 'secret123' }),
    );
    expect(callOptions.env.PATH).toBeDefined();
  });

  it('should pass cwd option to execFile', async () => {
    mockExecFileSuccess('', '');

    await safeExecFile('ls', ['-la'], { cwd: '/tmp/backups' });

    const callOptions = execFileMock.mock.calls[0][2];
    expect(callOptions.cwd).toBe('/tmp/backups');
  });

  it('should handle null stdout and stderr gracefully', async () => {
    execFileMock.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, callback: Function) => {
        callback(null, null, null);
      },
    );

    const result = await safeExecFile('echo', ['hello']);

    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });
});
