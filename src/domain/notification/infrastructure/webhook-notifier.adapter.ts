import axios from 'axios';
import { NotifierPort } from '@domain/notification/application/ports/notifier.port';
import { BackupResult } from '@domain/backup/domain/backup-result.model';
import { BackupStageError } from '@domain/backup/domain/backup-stage-error';
import { BackupStatus } from '@domain/backup/domain/value-objects/backup-status.enum';
import { formatFailureText, formatSuccessText, formatDailySummaryText } from './notification-formatter';

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

    await this.postWebhook({
      event: 'backup_started',
      project: projectName,
      text: `🔄 Backup started — ${projectName}\nTime: ${timestamp}`,
      data: { project_name: projectName, timestamp },
    });
  }

  async notifySuccess(result: BackupResult): Promise<void> {
    await this.postWebhook({
      event: 'backup_success',
      project: result.projectName,
      text: formatSuccessText(result),
      data: {
        run_id: result.runId,
        project_name: result.projectName,
        status: result.status,
        snapshot_id: result.syncResult?.snapshotId ?? null,
        dump_size_bytes: result.dumpResult?.sizeBytes ?? null,
        encrypted: result.encrypted,
        verified: result.verified,
        duration_ms: result.durationMs,
        timestamp: new Date().toISOString(),
      },
    });
  }

  async notifyFailure(projectName: string, error: BackupStageError): Promise<void> {
    await this.postWebhook({
      event: 'backup_failed',
      project: projectName,
      text: formatFailureText(projectName, error),
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
    await this.postWebhook({
      event: 'backup_warning',
      project: projectName,
      text: `⚠️ ${message}`,
      data: {
        project_name: projectName,
        message,
        timestamp: new Date().toISOString(),
      },
    });
  }

  async notifyDailySummary(results: BackupResult[]): Promise<void> {
    const date = new Date().toISOString().split('T')[0];
    const successCount = results.filter((r) => r.status === BackupStatus.Success).length;

    await this.postWebhook({
      event: 'daily_summary',
      project: 'all',
      text: formatDailySummaryText(results, date),
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

  private async postWebhook(payload: WebhookPayload): Promise<void> {
    await axios.post(this.webhookUrl, payload, {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
