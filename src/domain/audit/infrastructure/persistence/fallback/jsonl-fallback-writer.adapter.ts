import * as fs from 'fs';
import * as path from 'path';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';

import { BackupResult } from '@domain/backup/domain/backup-result.model';
import { FallbackEntry, FallbackWriterPort } from '@domain/audit/application/ports/fallback-writer.port';

@Injectable()
export class JsonlFallbackWriterAdapter implements FallbackWriterPort {
  private readonly fallbackDir: string;
  private readonly fallbackFile: string;

  constructor(configService: ConfigService) {
    const baseDir = configService.get<string>('BACKUP_BASE_DIR', '/data/backups');
    this.fallbackDir = path.join(baseDir, '.fallback-audit');
    this.fallbackFile = path.join(this.fallbackDir, 'fallback.jsonl');
  }

  writeAuditFallback(result: BackupResult): Promise<void> {
    const entry: FallbackEntry = {
      id: uuidv4(),
      type: 'audit',
      payload: result,
      timestamp: new Date().toISOString(),
    };

    this.appendEntry(entry);
    return Promise.resolve();
  }

  writeNotificationFallback(
    notificationType: string,
    payload: unknown,
  ): Promise<void> {
    const entry: FallbackEntry = {
      id: uuidv4(),
      type: 'notification',
      payload: { notificationType, ...(payload as Record<string, unknown>) },
      timestamp: new Date().toISOString(),
    };

    this.appendEntry(entry);
    return Promise.resolve();
  }

  readPendingEntries(): Promise<FallbackEntry[]> {
    if (!fs.existsSync(this.fallbackFile)) {
      return Promise.resolve([]);
    }

    const content = fs.readFileSync(this.fallbackFile, 'utf-8').trim();
    if (!content) {
      return Promise.resolve([]);
    }

    const entries: FallbackEntry[] = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line) as FallbackEntry);
      } catch {
        // Skip corrupt lines — partial write from a crash
      }
    }
    return Promise.resolve(entries);
  }

  async clearReplayed(ids: string[]): Promise<void> {
    if (!fs.existsSync(this.fallbackFile)) {
      return;
    }

    const idSet = new Set(ids);
    const entries = await this.readPendingEntries();
    const remaining = entries.filter((entry) => !idSet.has(entry.id));

    if (remaining.length === 0) {
      fs.unlinkSync(this.fallbackFile);
      return;
    }

    // Atomic write: write to temp file then rename to avoid corruption
    const tmpFile = `${this.fallbackFile}.tmp`;
    const lines = remaining.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
    fs.writeFileSync(tmpFile, lines, 'utf-8');
    fs.renameSync(tmpFile, this.fallbackFile);
  }

  private appendEntry(entry: FallbackEntry): void {
    fs.mkdirSync(this.fallbackDir, { recursive: true });
    fs.appendFileSync(this.fallbackFile, JSON.stringify(entry) + '\n', 'utf-8');
  }
}
