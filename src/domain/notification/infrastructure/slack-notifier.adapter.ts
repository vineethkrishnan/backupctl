import axios from 'axios';
import { NotifierPort } from '@domain/notification/application/ports/notifier.port';
import { BackupResult } from '@domain/backup/domain/backup-result.model';
import { BackupStageError } from '@domain/backup/domain/backup-stage-error';
import { extractSuccessDetail, buildDailySummaryEntries } from './notification-formatter.util';

// ── Slack Block Kit types ────────────────────────────

interface SlackTextElement {
  type: 'mrkdwn';
  text: string;
}

interface SlackSectionBlock {
  type: 'section';
  text?: SlackTextElement;
  fields?: SlackTextElement[];
}

interface SlackContextBlock {
  type: 'context';
  elements: SlackTextElement[];
}

interface SlackDividerBlock {
  type: 'divider';
}

type SlackBlock = SlackSectionBlock | SlackContextBlock | SlackDividerBlock;

interface SlackPayload {
  text: string;
  attachments: { color: string; blocks: SlackBlock[] }[];
}

const COLOR = {
  success: '#2ecc71',
  failure: '#e74c3c',
  warning: '#f39c12',
  started: '#3498db',
} as const;

// ── Adapter ──────────────────────────────────────────

export class SlackNotifierAdapter implements NotifierPort {
  constructor(
    private readonly webhookUrl: string,
    private readonly timezone: string = 'Europe/Berlin',
  ) {}

  async notifyStarted(projectName: string): Promise<void> {
    const time = new Date().toLocaleString('en-GB', { timeZone: this.timezone });

    await this.post({
      text: `🔄 Backup started — ${projectName}`,
      attachments: [{
        color: COLOR.started,
        blocks: [
          this.section(`🔄  *Backup started* — \`${projectName}\``),
          this.context(`🕐  ${time}`),
        ],
      }],
    });
  }

  async notifySuccess(result: BackupResult): Promise<void> {
    const d = extractSuccessDetail(result);
    const blocks: SlackBlock[] = [];

    // Header
    blocks.push(this.section(`✅  *Backup completed* — \`${result.projectName}\``));

    // Database details
    blocks.push(this.fields([
      `*Database*\n${result.projectName}`,
      `*Dump Size*\n${d.dumpSize}`,
      `*Encrypted*\n${d.encrypted === 'Yes' ? '🔒 Yes' : 'No'}`,
      `*Verified*\n${d.verified === 'Yes' ? '☑️ Yes' : 'No'}`,
    ]));

    // Snapshot details
    if (d.snapshot) {
      blocks.push(this.divider());
      blocks.push(this.fields([
        `*Snapshot*\n\`${d.snapshot.id}\``,
        `*Mode*\n${d.snapshot.mode}`,
        `*New Files*\n${d.snapshot.filesNew}`,
        `*Changed*\n${d.snapshot.filesChanged}`,
      ]));
      blocks.push(this.context(`📦  Added: ${d.snapshot.bytesAdded}`));
    }

    // Prune / cleanup
    if (d.prune ?? d.cleanup) {
      blocks.push(this.divider());
      const pruneFields: string[] = [];
      if (d.prune) pruneFields.push(`*Pruned*\n${d.prune.label}`);
      if (d.cleanup) pruneFields.push(`*Cleaned*\n${d.cleanup.label}`);
      blocks.push(this.fields(pruneFields));
    }

    // Duration footer
    blocks.push(this.context(`⏱️  Duration: ${d.duration}`));

    await this.post({
      text: `✅ ${result.projectName} — ${d.dumpSize}, ${d.duration}`,
      attachments: [{ color: COLOR.success, blocks }],
    });
  }

  async notifyFailure(projectName: string, error: BackupStageError): Promise<void> {
    await this.post({
      text: `❌ ${projectName} failed at ${error.stage}`,
      attachments: [{
        color: COLOR.failure,
        blocks: [
          this.section(`❌  *Backup failed* — \`${projectName}\``),
          this.fields([
            `*Stage*\n\`${error.stage}\``,
            `*Retryable*\n${error.isRetryable ? 'Yes' : 'No'}`,
          ]),
          this.section(`*Error*\n\`\`\`${error.message}\`\`\``),
        ],
      }],
    });
  }

  async notifyWarning(projectName: string, message: string): Promise<void> {
    await this.post({
      text: `⚠️ ${message}`,
      attachments: [{
        color: COLOR.warning,
        blocks: [
          this.section(`⚠️  *Warning* — \`${projectName}\`\n\n${message}`),
        ],
      }],
    });
  }

  async notifyDailySummary(results: BackupResult[]): Promise<void> {
    const date = new Date().toISOString().split('T')[0];
    const entries = buildDailySummaryEntries(results);
    const successCount = entries.filter((e) => e.isSuccess).length;
    const allPassed = successCount === entries.length;

    // Per-project rows
    const lines = entries.map((entry) => {
      if (entry.isSuccess) {
        return `✅  *${entry.projectName}*  —  ${entry.dumpSize}  —  ${entry.duration}  —  \`${entry.snapshotId}\``;
      }
      return `❌  *${entry.projectName}*  —  _${entry.errorMessage}_`;
    });

    const statusIcon = allPassed ? '🟢' : '🔴';

    await this.post({
      text: `📊 Backup summary ${date}: ${successCount}/${entries.length} successful`,
      attachments: [{
        color: allPassed ? COLOR.success : COLOR.failure,
        blocks: [
          this.section(`📊  *Daily Backup Summary* — ${date}`),
          this.divider(),
          this.section(lines.join('\n')),
          this.divider(),
          this.context(`${statusIcon}  *${successCount}/${entries.length}* successful  •  Next run: per project schedule`),
        ],
      }],
    });
  }

  // ── Block Kit helpers ──────────────────────────────

  private section(text: string): SlackSectionBlock {
    return { type: 'section', text: { type: 'mrkdwn', text } };
  }

  private fields(texts: string[]): SlackSectionBlock {
    return {
      type: 'section',
      fields: texts.map((text) => ({ type: 'mrkdwn' as const, text })),
    };
  }

  private context(text: string): SlackContextBlock {
    return { type: 'context', elements: [{ type: 'mrkdwn', text }] };
  }

  private divider(): SlackDividerBlock {
    return { type: 'divider' };
  }

  private async post(payload: SlackPayload): Promise<void> {
    await axios.post(this.webhookUrl, payload);
  }
}
