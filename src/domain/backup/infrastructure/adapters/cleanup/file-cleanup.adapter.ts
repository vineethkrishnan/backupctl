import { promises as fsp } from 'fs';
import * as path from 'path';

import { Injectable } from '@nestjs/common';

import { LocalCleanupPort } from '@domain/backup/application/ports/local-cleanup.port';
import { CleanupResult } from '@domain/backup/domain/value-objects/cleanup-result.model';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class FileCleanupAdapter implements LocalCleanupPort {
  async cleanup(directory: string, retentionDays: number): Promise<CleanupResult> {
    try {
      await fsp.access(directory);
    } catch {
      return new CleanupResult(0, 0);
    }

    const cutoffTime = Date.now() - retentionDays * MS_PER_DAY;
    const entries = await fsp.readdir(directory, { withFileTypes: true });

    let filesRemoved = 0;
    let spaceFreed = 0;

    for (const entry of entries) {
      if (!entry.isFile()) continue;

      const fullPath = path.join(directory, entry.name);
      const stats = await fsp.stat(fullPath);

      if (stats.mtimeMs < cutoffTime) {
        await fsp.unlink(fullPath);
        filesRemoved++;
        spaceFreed += stats.size;
      }
    }

    return new CleanupResult(filesRemoved, spaceFreed);
  }
}
