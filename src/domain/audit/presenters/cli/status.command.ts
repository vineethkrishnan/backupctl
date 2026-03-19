import { Command, CommandRunner, Option } from 'nest-commander';
import { GetBackupStatusUseCase } from '@domain/audit/application/use-cases/get-backup-status/get-backup-status.use-case';
import { GetBackupStatusQuery } from '@domain/audit/application/use-cases/get-backup-status/get-backup-status.query';
import { BackupResult } from '@domain/backup/domain/backup-result.model';
import { formatDuration } from '@common/helpers/format.util';

interface StatusOptions { last?: number; }

@Command({ name: 'status', description: 'Show backup status for a project or all projects', arguments: '[project]' })
export class StatusCommand extends CommandRunner {
  constructor(private readonly getBackupStatus: GetBackupStatusUseCase) { super(); }

  @Option({ flags: '--last <n>', description: 'Show last N entries' })
  parseLast(value: string): number { return parseInt(value, 10); }

  async run(params: string[], options?: StatusOptions): Promise<void> {
    try {
      const query = new GetBackupStatusQuery({
        projectName: params[0],
        limit: options?.last,
      });
      const results = await this.getBackupStatus.execute(query);

      if (results.length === 0) { console.log('No backup records found.'); return; }

      this.printTable(results);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      process.exitCode = 1;
    }
  }

  private printTable(results: BackupResult[]): void {
    console.log('Project'.padEnd(20) + 'Status'.padEnd(12) + 'Stage'.padEnd(16) + 'Duration'.padEnd(12) + 'Started At');
    console.log('─'.repeat(80));

    for (const result of results) {
      const icon = result.status === 'success' ? '✓' : '✗';
      console.log(
        `${icon} ${result.projectName.padEnd(18)}` +
          `${result.status.padEnd(12)}` +
          `${result.currentStage.padEnd(16)}` +
          `${formatDuration(result.durationMs).padEnd(12)}` +
          `${result.startedAt.toISOString()}`,
      );
    }
  }
}
