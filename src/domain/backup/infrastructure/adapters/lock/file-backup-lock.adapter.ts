import * as fs from 'fs';
import * as path from 'path';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BackupLockPort } from '@domain/backup/application/ports/backup-lock.port';

const POLL_INTERVAL_MS = 1000;
const MAX_WAIT_MS = 60 * 60 * 1000; // 1 hour — prevents infinite polling on orphaned locks

@Injectable()
export class FileBackupLockAdapter implements BackupLockPort {
  private readonly baseDir: string;

  constructor(configService: ConfigService) {
    this.baseDir = configService.get<string>('BACKUP_BASE_DIR', '/data/backups');
  }

  acquire(projectName: string): Promise<boolean> {
    const lockPath = this.lockFilePath(projectName);
    const projectDir = path.dirname(lockPath);
    fs.mkdirSync(projectDir, { recursive: true });

    // Atomic lock: O_CREAT | O_EXCL fails if file already exists — race-safe
    let fd: number;
    try {
      fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
    } catch {
      return Promise.resolve(false);
    }

    // Timestamp is informational — lock is the file's existence, not its content
    try {
      fs.writeSync(fd, new Date().toISOString());
    } catch {
      // Non-critical: lock file was already created by O_EXCL
    } finally {
      fs.closeSync(fd);
    }

    return Promise.resolve(true);
  }

  async acquireOrQueue(projectName: string): Promise<void> {
    let waited = 0;
    while (!(await this.acquire(projectName))) {
      if (waited >= MAX_WAIT_MS) {
        throw new Error(
          `Timed out waiting for lock on "${projectName}" after ${MAX_WAIT_MS / 60000} minutes`,
        );
      }
      await this.sleep(POLL_INTERVAL_MS);
      waited += POLL_INTERVAL_MS;
    }
  }

  release(projectName: string): Promise<void> {
    const lockPath = this.lockFilePath(projectName);

    try {
      fs.unlinkSync(lockPath);
    } catch {
      // Lock file already removed — safe to ignore
    }
    return Promise.resolve();
  }

  isLocked(projectName: string): boolean {
    return fs.existsSync(this.lockFilePath(projectName));
  }

  private lockFilePath(projectName: string): string {
    return path.join(this.baseDir, projectName, '.lock');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
