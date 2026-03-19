import axios from 'axios';
import { NotifierPort } from '@domain/notification/application/ports/notifier.port';
import { BackupResult } from '@domain/backup/domain/backup-result.model';
import { BackupStageError } from '@domain/backup/domain/backup-stage-error';
import { BackupStatus } from '@domain/backup/domain/value-objects/backup-status.enum';
import { formatBytes, formatDuration } from '@common/helpers/format.util';

export class SlackNotifierAdapter implements NotifierPort {
  constructor(private readonly webhookUrl: string) {}

  async notifyStarted(projectName: string): Promise<void> {
    const time = new Date().toLocaleString('en-GB', { timeZone: 'Europe/Berlin' });
    const text = `🔄 Backup started — ${projectName}\nTime: ${time}`;
    await this.postToSlack(text);
  }

  async notifySuccess(result: BackupResult): Promise<void> {
    const text = this.formatSuccessMessage(result);
    await this.postToSlack(text);
  }

  async notifyFailure(projectName: string, error: BackupStageError): Promise<void> {
    const text = [
      `❌ Backup failed — ${projectName}`,
      `Stage: ${error.stage} | Retryable: ${error.isRetryable ? 'Yes' : 'No'}`,
      `Error: ${error.message}`,
    ].join('\n');
    await this.postToSlack(text);
  }

  async notifyWarning(_projectName: string, message: string): Promise<void> {
    const text = `⚠️ ${message}`;
    await this.postToSlack(text);
  }

  async notifyDailySummary(results: BackupResult[]): Promise<void> {
    const text = this.formatDailySummary(results);
    await this.postToSlack(text);
  }

  private formatSuccessMessage(result: BackupResult): string {
    const lines = [`✅ Backup completed — ${result.projectName}`];

    const dumpSize = result.dumpResult ? formatBytes(result.dumpResult.sizeBytes) : 'N/A';
    const dumpPath = result.dumpResult?.filePath ?? 'N/A';
    const dbName = dumpPath.split('/').pop()?.split('.')[0] ?? result.projectName;
    lines.push(
      `DB: ${dbName} | Dump: ${dumpSize}` +
        ` | Encrypted: ${result.encrypted ? 'Yes' : 'No'}` +
        ` | Verified: ${result.verified ? 'Yes' : 'No'}`,
    );

    if (result.syncResult) {
      lines.push(
        `Snapshot: ${result.syncResult.snapshotId} | Mode: ${result.snapshotMode}`,
      );
      lines.push(
        `New files: ${result.syncResult.filesNew}` +
          ` | Changed: ${result.syncResult.filesChanged}` +
          ` | Added: ${formatBytes(result.syncResult.bytesAdded)}`,
      );
    }

    if (result.pruneResult || result.cleanupResult) {
      const pruned = result.pruneResult
        ? `${result.pruneResult.snapshotsRemoved} snapshots`
        : '0 snapshots';
      const cleaned = result.cleanupResult
        ? `${result.cleanupResult.filesRemoved} files`
        : '0 files';
      lines.push(`Pruned: ${pruned} | Local cleaned: ${cleaned}`);
    }

    lines.push(`Duration: ${formatDuration(result.durationMs)}`);

    return lines.join('\n');
  }

  private formatDailySummary(results: BackupResult[]): string {
    const date = new Date().toISOString().split('T')[0];
    const lines = [`📊 Daily Backup Summary — ${date}`, ''];

    for (const result of results) {
      if (result.status === BackupStatus.Success) {
        const dumpSize = result.dumpResult
          ? formatBytes(result.dumpResult.sizeBytes)
          : 'N/A';
        const snapshotId = result.syncResult?.snapshotId ?? 'N/A';
        lines.push(
          `✅ ${result.projectName}` +
            ` — ${dumpSize}` +
            ` — ${formatDuration(result.durationMs)}` +
            ` — ${snapshotId}`,
        );
      } else {
        lines.push(
          `❌ ${result.projectName} — FAILED — ${result.errorMessage ?? 'unknown error'}`,
        );
      }
    }

    const successCount = results.filter((r) => r.status === BackupStatus.Success).length;
    lines.push('');
    lines.push(
      `Total: ${successCount}/${results.length} successful | Next run: per project schedule`,
    );

    return lines.join('\n');
  }

  private async postToSlack(text: string): Promise<void> {
    await axios.post(this.webhookUrl, { text });
  }
}
