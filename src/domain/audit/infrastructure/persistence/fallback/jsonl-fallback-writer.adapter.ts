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

  async writeAuditFallback(result: BackupResult): Promise<void> {
    const entry: FallbackEntry = {
      id: uuidv4(),
      type: 'audit',
      payload: result,
      timestamp: new Date().toISOString(),
    };

    this.appendEntry(entry);
  }

  async writeNotificationFallback(
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
  }

  async readPendingEntries(): Promise<FallbackEntry[]> {
    if (!fs.existsSync(this.fallbackFile)) {
      return [];
    }

    const content = fs.readFileSync(this.fallbackFile, 'utf-8').trim();
    if (!content) {
      return [];
    }

    return content
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as FallbackEntry);
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

    const lines = remaining.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
    fs.writeFileSync(this.fallbackFile, lines, 'utf-8');
  }

  private appendEntry(entry: FallbackEntry): void {
    fs.mkdirSync(this.fallbackDir, { recursive: true });
    fs.appendFileSync(this.fallbackFile, JSON.stringify(entry) + '\n', 'utf-8');
  }
}
