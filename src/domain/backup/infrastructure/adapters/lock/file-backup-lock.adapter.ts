import * as fs from 'fs';
import * as path from 'path';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BackupLockPort } from '@domain/backup/application/ports/backup-lock.port';

const POLL_INTERVAL_MS = 1000;

@Injectable()
export class FileBackupLockAdapter implements BackupLockPort {
  private readonly baseDir: string;

  constructor(configService: ConfigService) {
    this.baseDir = configService.get<string>('BACKUP_BASE_DIR', '/data/backups');
  }

  async acquire(projectName: string): Promise<boolean> {
    const lockPath = this.lockFilePath(projectName);

    if (fs.existsSync(lockPath)) {
      return false;
    }

    const projectDir = path.dirname(lockPath);
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(lockPath, new Date().toISOString(), 'utf-8');

    return true;
  }

  async acquireOrQueue(projectName: string): Promise<void> {
    while (!(await this.acquire(projectName))) {
      await this.sleep(POLL_INTERVAL_MS);
    }
  }

  async release(projectName: string): Promise<void> {
    const lockPath = this.lockFilePath(projectName);

    try {
      fs.unlinkSync(lockPath);
    } catch {
      // Lock file already removed — safe to ignore
    }
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
