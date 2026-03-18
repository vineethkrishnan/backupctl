import { Command, CommandRunner, Option } from 'nest-commander';

import { AuditQueryService } from '@application/audit/audit-query.service';
import { BackupResult } from '@domain/backup/models/backup-result.model';
import { formatDuration } from '@shared/format.util';

interface LogsOptions {
  last?: number;
  failed?: boolean;
}

@Command({
  name: 'logs',
  description: 'Show backup logs for a project',
  arguments: '<project>',
})
export class LogsCommand extends CommandRunner {
  constructor(
    private readonly auditQuery: AuditQueryService,
  ) {
    super();
  }

  @Option({
    flags: '--last <n>',
    description: 'Show last N log entries',
  })
  parseLast(value: string): number {
    return parseInt(value, 10);
  }

  @Option({
    flags: '--failed',
    description: 'Show only failed backups',
  })
  parseFailed(): boolean {
    return true;
  }

  async run(params: string[], options?: LogsOptions): Promise<void> {
    const projectName = params[0];

    try {
      let results: BackupResult[];

      if (options?.failed) {
        results = await this.auditQuery.getFailedLogs(projectName, options?.last);
      } else {
        results = await this.auditQuery.getStatus(projectName, options?.last);
      }

      if (results.length === 0) {
        console.log(`No log entries found for ${projectName}.`);
        return;
      }

      console.log(`Backup logs for ${projectName}:\n`);

      for (const result of results) {
        this.printEntry(result);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      process.exitCode = 1;
    }
  }

  private printEntry(result: BackupResult): void {
    const icon = result.status === 'success' ? '✓' : '✗';
    const duration = formatDuration(result.durationMs);

    console.log(
      `${icon} [${result.startedAt.toISOString()}] ${result.status} — ${duration}` +
        `${result.retryCount > 0 ? ` (${result.retryCount} retries)` : ''}`,
    );

    if (result.errorMessage) {
      console.log(`  Stage: ${result.errorStage} — ${result.errorMessage}`);
    }
  }
}
