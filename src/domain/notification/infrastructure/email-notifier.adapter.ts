import { createTransport, type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { NotifierPort } from '@domain/notification/application/ports/notifier.port';
import { BackupResult } from '@domain/backup/domain/backup-result.model';
import { BackupStageError } from '@domain/backup/domain/backup-stage-error';
import { BackupStatus } from '@domain/backup/domain/value-objects/backup-status.enum';
import { formatBytes, formatDuration } from '@common/helpers/format.util';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  to: string;
  from: string;
}

export class EmailNotifierAdapter implements NotifierPort {
  private readonly transporter: Transporter<SMTPTransport.SentMessageInfo>;
  private readonly to: string;
  private readonly from: string;

  constructor(smtpConfig: SmtpConfig) {
    this.transporter = createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
      auth: {
        user: smtpConfig.user,
        pass: smtpConfig.password,
      },
    });
    this.to = smtpConfig.to;
    this.from = smtpConfig.from;
  }

  async notifyStarted(projectName: string): Promise<void> {
    const time = new Date().toLocaleString('en-GB', { timeZone: 'Europe/Berlin' });
    const html = `<h2>🔄 Backup started — ${projectName}</h2><p>Time: ${time}</p>`;
    await this.sendMail(`🔄 Backup started — ${projectName}`, html);
  }

  async notifySuccess(result: BackupResult): Promise<void> {
    const html = this.formatSuccessHtml(result);
    await this.sendMail(`✅ Backup completed — ${result.projectName}`, html);
  }

  async notifyFailure(projectName: string, error: BackupStageError): Promise<void> {
    const html = [
      `<h2>❌ Backup failed — ${projectName}</h2>`,
      '<table>',
      `<tr><td><strong>Stage</strong></td><td>${error.stage}</td></tr>`,
      `<tr><td><strong>Retryable</strong></td><td>${error.isRetryable ? 'Yes' : 'No'}</td></tr>`,
      `<tr><td><strong>Error</strong></td><td>${error.message}</td></tr>`,
      '</table>',
    ].join('');
    await this.sendMail(`❌ Backup failed — ${projectName}`, html);
  }

  async notifyWarning(projectName: string, message: string): Promise<void> {
    const html = `<h2>⚠️ Warning — ${projectName}</h2><p>${message}</p>`;
    await this.sendMail(`⚠️ Backup warning — ${projectName}`, html);
  }

  async notifyDailySummary(results: BackupResult[]): Promise<void> {
    const date = new Date().toISOString().split('T')[0];
    const html = this.formatDailySummaryHtml(results, date);
    await this.sendMail(`📊 Daily Backup Summary — ${date}`, html);
  }

  private formatSuccessHtml(result: BackupResult): string {
    const dumpSize = result.dumpResult ? formatBytes(result.dumpResult.sizeBytes) : 'N/A';
    const dumpPath = result.dumpResult?.filePath ?? 'N/A';
    const dbName = dumpPath.split('/').pop()?.split('.')[0] ?? result.projectName;

    const rows = [
      `<tr><td><strong>DB</strong></td><td>${dbName}</td></tr>`,
      `<tr><td><strong>Dump Size</strong></td><td>${dumpSize}</td></tr>`,
      `<tr><td><strong>Encrypted</strong></td><td>${result.encrypted ? 'Yes' : 'No'}</td></tr>`,
      `<tr><td><strong>Verified</strong></td><td>${result.verified ? 'Yes' : 'No'}</td></tr>`,
    ];

    if (result.syncResult) {
      rows.push(
        `<tr><td><strong>Snapshot</strong></td><td>${result.syncResult.snapshotId}</td></tr>`,
        `<tr><td><strong>Mode</strong></td><td>${result.snapshotMode}</td></tr>`,
        `<tr><td><strong>New Files</strong></td><td>${result.syncResult.filesNew}</td></tr>`,
        `<tr><td><strong>Changed Files</strong></td><td>${result.syncResult.filesChanged}</td></tr>`,
        `<tr><td><strong>Added</strong></td><td>${formatBytes(result.syncResult.bytesAdded)}</td></tr>`,
      );
    }

    if (result.pruneResult) {
      rows.push(
        `<tr><td><strong>Pruned</strong></td><td>${result.pruneResult.snapshotsRemoved} snapshots</td></tr>`,
      );
    }

    if (result.cleanupResult) {
      rows.push(
        `<tr><td><strong>Local Cleaned</strong></td><td>${result.cleanupResult.filesRemoved} files</td></tr>`,
      );
    }

    rows.push(
      `<tr><td><strong>Duration</strong></td><td>${formatDuration(result.durationMs)}</td></tr>`,
    );

    return `<h2>✅ Backup completed — ${result.projectName}</h2><table>${rows.join('')}</table>`;
  }

  private formatDailySummaryHtml(results: BackupResult[], date: string): string {
    const rows = results.map((result) => {
      if (result.status === BackupStatus.Success) {
        const dumpSize = result.dumpResult
          ? formatBytes(result.dumpResult.sizeBytes)
          : 'N/A';
        const snapshotId = result.syncResult?.snapshotId ?? 'N/A';
        return (
          `<tr><td>✅</td><td>${result.projectName}</td>` +
          `<td>${dumpSize}</td><td>${formatDuration(result.durationMs)}</td>` +
          `<td>${snapshotId}</td></tr>`
        );
      }
      return (
        `<tr><td>❌</td><td>${result.projectName}</td>` +
        `<td colspan="3">FAILED — ${result.errorMessage ?? 'unknown error'}</td></tr>`
      );
    });

    const successCount = results.filter((r) => r.status === BackupStatus.Success).length;

    return [
      `<h2>📊 Daily Backup Summary — ${date}</h2>`,
      '<table><thead><tr><th></th><th>Project</th><th>Size</th><th>Duration</th><th>Snapshot</th></tr></thead>',
      `<tbody>${rows.join('')}</tbody></table>`,
      `<p>Total: ${successCount}/${results.length} successful | Next run: per project schedule</p>`,
    ].join('');
  }

  private async sendMail(subject: string, html: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: this.to,
      subject,
      html,
    });
  }
}
