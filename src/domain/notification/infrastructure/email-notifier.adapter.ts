import { createTransport, type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { NotifierPort } from '@domain/notification/application/ports/notifier.port';
import { BackupResult } from '@domain/backup/domain/backup-result.model';
import { BackupStageError } from '@domain/backup/domain/backup-stage-error';
import { formatDuration } from '@common/helpers/format.util';
import { extractSuccessDetail, buildDailySummaryEntries } from './notification-formatter.util';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  to: string;
  from: string;
  timezone?: string;
}

export class EmailNotifierAdapter implements NotifierPort {
  private readonly transporter: Transporter<SMTPTransport.SentMessageInfo>;
  private readonly to: string;
  private readonly from: string;
  private readonly timezone: string;

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
    this.timezone = smtpConfig.timezone ?? 'Europe/Berlin';
  }

  async notifyStarted(projectName: string): Promise<void> {
    const time = new Date().toLocaleString('en-GB', { timeZone: this.timezone });
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
    const d = extractSuccessDetail(result);

    const rows = [
      `<tr><td><strong>DB</strong></td><td>${d.dbName}</td></tr>`,
      `<tr><td><strong>Dump Size</strong></td><td>${d.dumpSize}</td></tr>`,
      `<tr><td><strong>Encrypted</strong></td><td>${d.encrypted}</td></tr>`,
      `<tr><td><strong>Verified</strong></td><td>${d.verified}</td></tr>`,
    ];

    if (d.snapshot) {
      rows.push(
        `<tr><td><strong>Snapshot</strong></td><td>${d.snapshot.id}</td></tr>`,
        `<tr><td><strong>Mode</strong></td><td>${d.snapshot.mode}</td></tr>`,
        `<tr><td><strong>New Files</strong></td><td>${d.snapshot.filesNew}</td></tr>`,
        `<tr><td><strong>Changed Files</strong></td><td>${d.snapshot.filesChanged}</td></tr>`,
        `<tr><td><strong>Added</strong></td><td>${d.snapshot.bytesAdded}</td></tr>`,
      );
    }

    if (d.prune) {
      rows.push(`<tr><td><strong>Pruned</strong></td><td>${d.prune.label}</td></tr>`);
    }

    if (d.cleanup) {
      rows.push(`<tr><td><strong>Local Cleaned</strong></td><td>${d.cleanup.label}</td></tr>`);
    }

    rows.push(`<tr><td><strong>Duration</strong></td><td>${d.duration}</td></tr>`);

    return `<h2>✅ Backup completed — ${result.projectName}</h2><table>${rows.join('')}</table>`;
  }

  private formatDailySummaryHtml(results: BackupResult[], date: string): string {
    const entries = buildDailySummaryEntries(results);

    const rows = entries.map((entry) => {
      if (entry.isSuccess) {
        return (
          `<tr><td>${entry.icon}</td><td>${entry.projectName}</td>` +
          `<td>${entry.dumpSize}</td><td>${formatDuration(results.find((r) => r.projectName === entry.projectName)?.durationMs ?? 0)}</td>` +
          `<td>${entry.snapshotId}</td></tr>`
        );
      }
      return (
        `<tr><td>${entry.icon}</td><td>${entry.projectName}</td>` +
        `<td colspan="3">FAILED — ${entry.errorMessage}</td></tr>`
      );
    });

    const successCount = entries.filter((e) => e.isSuccess).length;

    return [
      `<h2>📊 Daily Backup Summary — ${date}</h2>`,
      '<table><thead><tr><th></th><th>Project</th><th>Size</th><th>Duration</th><th>Snapshot</th></tr></thead>',
      `<tbody>${rows.join('')}</tbody></table>`,
      `<p>Total: ${successCount}/${entries.length} successful | Next run: per project schedule</p>`,
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
