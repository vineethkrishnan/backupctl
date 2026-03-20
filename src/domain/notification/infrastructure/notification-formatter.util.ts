import { BackupResult, BackupType } from '@domain/backup/domain/backup-result.model';
import { BackupStageError } from '@domain/backup/domain/backup-stage-error';
import { BackupStatus } from '@domain/backup/domain/value-objects/backup-status.enum';
import { formatBytes, formatDuration } from '@common/helpers/format.util';

export interface SuccessDetail {
  dbName: string;
  dumpSize: string;
  encrypted: string;
  verified: string;
  modeLabel: string;
  snapshot: { id: string; mode: string; filesNew: number; filesChanged: number; bytesAdded: string } | null;
  prune: { label: string } | null;
  cleanup: { label: string } | null;
  duration: string;
}

export interface DailySummaryEntry {
  icon: string;
  projectName: string;
  isSuccess: boolean;
  dumpSize: string;
  duration: string;
  snapshotId: string;
  errorMessage: string;
}

export function resolveModeLabel(
  backupType: BackupType,
  snapshotMode: 'combined' | 'separate',
): string {
  if (backupType === 'database') return 'database';
  if (backupType === 'assets') return 'assets';
  return snapshotMode === 'combined' ? 'db + assets' : 'db + assets (split)';
}

// Extract common fields from a BackupResult for success formatting
export function extractSuccessDetail(result: BackupResult): SuccessDetail {
  const dumpSize = result.dumpResult ? formatBytes(result.dumpResult.sizeBytes) : 'N/A';
  const dbName = result.dumpResult
    ? (result.dumpResult.filePath.split('/').pop()?.split('.')[0] ?? result.projectName)
    : result.projectName;

  const modeLabel = resolveModeLabel(result.backupType, result.snapshotMode);

  const snapshot = result.syncResult
    ? {
        id: result.syncResult.snapshotId,
        mode: result.snapshotMode,
        filesNew: result.syncResult.filesNew,
        filesChanged: result.syncResult.filesChanged,
        bytesAdded: formatBytes(result.syncResult.bytesAdded),
      }
    : null;

  const prune = result.pruneResult
    ? { label: `${result.pruneResult.snapshotsRemoved} snapshots` }
    : null;

  const cleanup = result.cleanupResult
    ? { label: `${result.cleanupResult.filesRemoved} files` }
    : null;

  return {
    dbName,
    dumpSize,
    encrypted: result.encrypted ? 'Yes' : 'No',
    verified: result.verified ? 'Yes' : 'No',
    modeLabel,
    snapshot,
    prune,
    cleanup,
    duration: formatDuration(result.durationMs),
  };
}

// Build a daily summary entry list from results
export function buildDailySummaryEntries(results: BackupResult[]): DailySummaryEntry[] {
  return results.map((result) => {
    const isSuccess = result.status === BackupStatus.Success;
    return {
      icon: isSuccess ? '✅' : '❌',
      projectName: result.projectName,
      isSuccess,
      dumpSize: result.dumpResult ? formatBytes(result.dumpResult.sizeBytes) : 'N/A',
      duration: formatDuration(result.durationMs),
      snapshotId: result.syncResult?.snapshotId ?? 'N/A',
      errorMessage: result.errorMessage ?? 'unknown error',
    };
  });
}

// Format failure text (shared across all notifiers)
export function formatFailureText(projectName: string, error: BackupStageError): string {
  return [
    `❌ Backup failed — ${projectName}`,
    `Stage: ${error.stage} | Retryable: ${error.isRetryable ? 'Yes' : 'No'}`,
    `Error: ${error.message}`,
  ].join('\n');
}

// Format a plaintext success message (Slack / Webhook text field)
export function formatSuccessText(result: BackupResult): string {
  const d = extractSuccessDetail(result);
  const lines = [`✅ Backup completed — ${result.projectName}`];

  lines.push(`DB: ${d.dbName} | Dump: ${d.dumpSize} | Encrypted: ${d.encrypted} | Verified: ${d.verified}`);

  if (d.snapshot) {
    lines.push(`Snapshot: ${d.snapshot.id} | Mode: ${d.modeLabel}`);
    lines.push(`New files: ${d.snapshot.filesNew} | Changed: ${d.snapshot.filesChanged} | Added: ${d.snapshot.bytesAdded}`);
  }

  if (d.prune ?? d.cleanup) {
    const pruned = d.prune?.label ?? '0 snapshots';
    const cleaned = d.cleanup?.label ?? '0 files';
    lines.push(`Pruned: ${pruned} | Local cleaned: ${cleaned}`);
  }

  lines.push(`Duration: ${d.duration}`);
  return lines.join('\n');
}

// Format a plaintext daily summary (Slack / Webhook text field)
export function formatDailySummaryText(results: BackupResult[], date: string): string {
  const entries = buildDailySummaryEntries(results);
  const lines = [`📊 Daily Backup Summary — ${date}`, ''];

  for (const entry of entries) {
    if (entry.isSuccess) {
      lines.push(`${entry.icon} ${entry.projectName} — ${entry.dumpSize} — ${entry.duration} — ${entry.snapshotId}`);
    } else {
      lines.push(`${entry.icon} ${entry.projectName} — FAILED — ${entry.errorMessage}`);
    }
  }

  const successCount = entries.filter((e) => e.isSuccess).length;
  lines.push('');
  lines.push(`Total: ${successCount}/${entries.length} successful | Next run: per project schedule`);

  return lines.join('\n');
}
