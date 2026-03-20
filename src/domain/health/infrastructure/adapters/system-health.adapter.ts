import { Injectable, Logger } from '@nestjs/common';
import { SystemHealthPort, DiskSpaceResult, SshCheckConfig } from '../../application/ports/system-health.port';
import { safeExecFile } from '@common/helpers/child-process.util';

@Injectable()
export class SystemHealthAdapter implements SystemHealthPort {
  private readonly logger = new Logger(SystemHealthAdapter.name);

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

  async checkSshConnectivity(config: SshCheckConfig): Promise<boolean> {
    try {
      // Hetzner Storage Boxes have a restricted shell — no echo/ls/true available.
      // Use SSH's own exit-on-connect (-o LogLevel=error suppresses banners) to
      // verify connectivity without executing a remote command.
      await safeExecFile('ssh', [
        '-i', config.keyPath,
        '-p', String(config.port),
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'ConnectTimeout=5',
        '-o', 'BatchMode=yes',
        '-o', 'LogLevel=error',
        `${config.user}@${config.host}`,
        'exit',
      ], { timeout: 15000 });
      return true;
    } catch (error) {
      const message = (error as Error).message;
      // "Command not found" means SSH connected but the restricted shell rejected
      // the command — connectivity is actually fine
      if (message.includes('Command not found')) {
        return true;
      }
      this.logger.warn(`SSH connectivity check failed: ${message}`);
      return false;
    }
  }

  async checkSshAuthentication(keyPath: string): Promise<boolean> {
    if (!keyPath) return false;
    try {
      const { stdout } = await safeExecFile('ssh-keygen', ['-l', '-f', keyPath], { timeout: 5000 });
      return stdout.length > 0;
    } catch {
      return false;
    }
  }
}
