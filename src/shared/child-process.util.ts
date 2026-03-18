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
  const { timeout = 30000, env, cwd } = options;

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
          const message = error.message;
          reject(new Error(`Command "${command} ${args.join(' ')}" failed: ${message}`));
          return;
        }
        resolve({ stdout: stdout ?? '', stderr: stderr ?? '' });
      },
    );
  });
}
