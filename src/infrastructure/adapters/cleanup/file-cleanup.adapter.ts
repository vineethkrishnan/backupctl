import * as fs from 'fs';
import * as path from 'path';

import { Injectable } from '@nestjs/common';

import { LocalCleanupPort } from '@domain/backup/ports/local-cleanup.port';
import { CleanupResult } from '@domain/backup/models/cleanup-result.model';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class FileCleanupAdapter implements LocalCleanupPort {
  async cleanup(directory: string, retentionDays: number): Promise<CleanupResult> {
    if (!fs.existsSync(directory)) {
      return new CleanupResult(0, 0);
    }

    const cutoffTime = Date.now() - retentionDays * MS_PER_DAY;
    const entries = fs.readdirSync(directory);

    let filesRemoved = 0;
    let spaceFreed = 0;

    for (const entry of entries) {
      const fullPath = path.join(directory, entry);
      const stats = fs.statSync(fullPath);

      if (!stats.isFile()) {
        continue;
      }

      if (stats.mtimeMs < cutoffTime) {
        fs.unlinkSync(fullPath);
        filesRemoved++;
        spaceFreed += stats.size;
      }
    }

    return new CleanupResult(filesRemoved, spaceFreed);
  }
}
