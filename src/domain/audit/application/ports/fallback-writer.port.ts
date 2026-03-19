import { BackupResult } from '@domain/backup/domain/backup-result.model';

export interface FallbackEntry {
  readonly id: string;
  readonly type: 'audit' | 'notification';
  readonly payload: unknown;
  readonly timestamp: string;
}

export interface FallbackWriterPort {
  writeAuditFallback(result: BackupResult): Promise<void>;
  writeNotificationFallback(notificationType: string, payload: unknown): Promise<void>;
  readPendingEntries(): Promise<FallbackEntry[]>;
  clearReplayed(ids: string[]): Promise<void>;
}
