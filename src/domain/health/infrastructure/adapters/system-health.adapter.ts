import { Injectable } from '@nestjs/common';
import { SystemHealthPort, DiskSpaceResult } from '../../application/ports/system-health.port';
import { safeExecFile } from '@common/helpers/child-process.util';

@Injectable()
export class SystemHealthAdapter implements SystemHealthPort {
  async checkDiskSpace(path: string, minFreeGb: number): Promise<DiskSpaceResult> {
    try {
      // BusyBox (Alpine) df doesn't support -BG/--output — use POSIX-compatible format
      const { stdout } = await safeExecFile('df', ['-k', path]);
      const lines = stdout.trim().split('\n');
      const fields = lines[lines.length - 1].trim().split(/\s+/);
      // POSIX df -k: filesystem, 1K-blocks, used, available, capacity%, mountpoint
      const availKb = parseInt(fields[3], 10);
      const freeGb = parseFloat((availKb / (1024 * 1024)).toFixed(2));

      return { available: freeGb >= minFreeGb, freeGb };
    } catch {
      return { available: false, freeGb: 0 };
    }
  }
}
