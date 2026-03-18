import { Injectable } from '@nestjs/common';

import { HookExecutorPort } from '@domain/backup/ports/hook-executor.port';
import { safeExecFile } from '@shared/child-process.util';

const HOOK_TIMEOUT_MS = 60_000;

@Injectable()
export class ShellHookExecutorAdapter implements HookExecutorPort {
  async execute(command: string): Promise<void> {
    await safeExecFile('/bin/sh', ['-c', command], {
      timeout: HOOK_TIMEOUT_MS,
    });
  }
}
