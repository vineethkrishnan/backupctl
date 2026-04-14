import { execFile } from 'child_process';

export interface ExecOptions {
  env?: Record<string, string>;
  timeout?: number;
  cwd?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export async function safeExecFile(
  command: string,
  args: string[],
  options: ExecOptions = {},
): Promise<ExecResult> {
  const { timeout = 1800000, env, cwd } = options;

  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        timeout,
        env: env ? { ...process.env, ...env } : process.env,
        cwd,
        maxBuffer: 50 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr?.trim() || error.message;
          reject(new Error(`Command "${command}" failed: ${detail}`));
          return;
        }
        resolve({ stdout: stdout ?? '', stderr: stderr ?? '' });
      },
    );
  });
}
