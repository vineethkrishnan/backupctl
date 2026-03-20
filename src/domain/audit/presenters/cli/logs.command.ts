import { Command, CommandRunner, Option } from 'nest-commander';
import { GetBackupStatusUseCase } from '@domain/audit/application/use-cases/get-backup-status/get-backup-status.use-case';
import { GetBackupStatusQuery } from '@domain/audit/application/use-cases/get-backup-status/get-backup-status.query';
import { GetFailedLogsUseCase } from '@domain/audit/application/use-cases/get-failed-logs/get-failed-logs.use-case';
import { GetFailedLogsQuery } from '@domain/audit/application/use-cases/get-failed-logs/get-failed-logs.query';
import { BackupResult } from '@domain/backup/domain/backup-result.model';
import { BackupStatus } from '@domain/backup/domain/value-objects/backup-status.enum';
import { formatDuration } from '@common/helpers/format.util';

interface LogsOptions { last?: number; failed?: boolean; }

@Command({ name: 'logs', description: 'Show backup logs for a project', arguments: '<project>' })
export class LogsCommand extends CommandRunner {
  constructor(
    private readonly getBackupStatus: GetBackupStatusUseCase,
    private readonly getFailedLogs: GetFailedLogsUseCase,
  ) { super(); }

  @Option({ flags: '--last <n>', description: 'Show last N log entries' })
  parseLast(value: string): number {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed) || parsed < 1) {
      console.error('Error: --last must be a positive integer');
      process.exitCode = 3;
      return 10;
    }
    return parsed;
  }

  @Option({ flags: '--failed', description: 'Show only failed backups' })
  parseFailed(): boolean { return true; }

  async run(params: string[], options?: LogsOptions): Promise<void> {
    const projectName = params[0];

    try {
      let results: BackupResult[];

      if (options?.failed) {
        results = await this.getFailedLogs.execute(
          new GetFailedLogsQuery({ projectName, limit: options?.last }),
        );
      } else {
        results = await this.getBackupStatus.execute(
          new GetBackupStatusQuery({ projectName, limit: options?.last }),
        );
      }

      if (results.length === 0) { console.log(`No log entries found for ${projectName}.`); return; }

      console.log(`Backup logs for ${projectName}:\n`);

      for (const result of results) { this.printEntry(result); }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      process.exitCode = 1;
    }
  }

  private printEntry(result: BackupResult): void {
    const icon = result.status === BackupStatus.Success ? '✓' : '✗';
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
