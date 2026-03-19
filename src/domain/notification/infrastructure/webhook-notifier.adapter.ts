import axios from 'axios';
import { NotifierPort } from '@domain/notification/application/ports/notifier.port';
import { BackupResult } from '@domain/backup/domain/backup-result.model';
import { BackupStageError } from '@domain/backup/domain/backup-stage-error';
import { BackupStatus } from '@domain/backup/domain/value-objects/backup-status.enum';
import { formatBytes, formatDuration } from '@common/helpers/format.util';

type WebhookEvent =
  | 'backup_started'
  | 'backup_success'
  | 'backup_failed'
  | 'backup_warning'
  | 'daily_summary';

interface WebhookPayload {
  event: WebhookEvent;
  project: string;
  text: string;
  data: Record<string, unknown>;
}

export class WebhookNotifierAdapter implements NotifierPort {
  constructor(private readonly webhookUrl: string) {}

  async notifyStarted(projectName: string): Promise<void> {
    const timestamp = new Date().toISOString();
    const text = `🔄 Backup started — ${projectName}\nTime: ${timestamp}`;

    await this.postWebhook({
      event: 'backup_started',
      project: projectName,
      text,
      data: { project_name: projectName, timestamp },
    });
  }

  async notifySuccess(result: BackupResult): Promise<void> {
    const text = this.formatSuccessText(result);
    const data = this.buildSuccessData(result);

    await this.postWebhook({
      event: 'backup_success',
      project: result.projectName,
      text,
      data,
    });
  }

  async notifyFailure(projectName: string, error: BackupStageError): Promise<void> {
    const text = [
      `❌ Backup failed — ${projectName}`,
      `Stage: ${error.stage} | Retryable: ${error.isRetryable ? 'Yes' : 'No'}`,
      `Error: ${error.message}`,
    ].join('\n');

    await this.postWebhook({
      event: 'backup_failed',
      project: projectName,
      text,
      data: {
        project_name: projectName,
        stage: error.stage,
        is_retryable: error.isRetryable,
        error_message: error.message,
        timestamp: new Date().toISOString(),
      },
    });
  }

  async notifyWarning(projectName: string, message: string): Promise<void> {
    const text = `⚠️ ${message}`;

    await this.postWebhook({
      event: 'backup_warning',
      project: projectName,
      text,
      data: {
        project_name: projectName,
        message,
        timestamp: new Date().toISOString(),
      },
    });
  }

  async notifyDailySummary(results: BackupResult[]): Promise<void> {
    const date = new Date().toISOString().split('T')[0];
    const text = this.formatDailySummaryText(results, date);
    const successCount = results.filter((r) => r.status === BackupStatus.Success).length;

    await this.postWebhook({
      event: 'daily_summary',
      project: 'all',
      text,
      data: {
        date,
        total: results.length,
        successful: successCount,
        failed: results.length - successCount,
        projects: results.map((r) => ({
          project_name: r.projectName,
          status: r.status,
          duration_ms: r.durationMs,
          snapshot_id: r.syncResult?.snapshotId ?? null,
          dump_size_bytes: r.dumpResult?.sizeBytes ?? null,
          error_message: r.errorMessage ?? null,
        })),
      },
    });
  }

  private formatSuccessText(result: BackupResult): string {
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

  private buildSuccessData(result: BackupResult): Record<string, unknown> {
    return {
      run_id: result.runId,
      project_name: result.projectName,
      status: result.status,
      snapshot_id: result.syncResult?.snapshotId ?? null,
      dump_size_bytes: result.dumpResult?.sizeBytes ?? null,
      encrypted: result.encrypted,
      verified: result.verified,
      duration_ms: result.durationMs,
      timestamp: new Date().toISOString(),
    };
  }

  private formatDailySummaryText(results: BackupResult[], date: string): string {
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

  private async postWebhook(payload: WebhookPayload): Promise<void> {
    await axios.post(this.webhookUrl, payload, {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
