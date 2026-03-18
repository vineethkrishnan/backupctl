import { Command, CommandRunner, Option } from 'nest-commander';

import { BackupOrchestratorService } from '@application/backup/backup-orchestrator.service';
import { BackupResult } from '@domain/backup/models/backup-result.model';
import { BackupStatus } from '@domain/backup/models/backup-status.enum';
import { formatBytes, formatDuration } from '@shared/format.util';

interface RunOptions {
  all?: boolean;
  dryRun?: boolean;
}

@Command({
  name: 'run',
  description: 'Trigger backup for a project or all projects',
  arguments: '[project]',
})
export class RunCommand extends CommandRunner {
  constructor(
    private readonly backupOrchestrator: BackupOrchestratorService,
  ) {
    super();
  }

  @Option({
    flags: '--all',
    description: 'Run backup for all enabled projects',
  })
  parseAll(): boolean {
    return true;
  }

  @Option({
    flags: '--dry-run',
    description: 'Simulate backup without executing (validates config, checks connectivity)',
  })
  parseDryRun(): boolean {
    return true;
  }

  async run(params: string[], options?: RunOptions): Promise<void> {
    try {
      if (options?.all) {
        await this.runAll();
        return;
      }

      const projectName = params[0];
      if (!projectName) {
        console.error('Error: project name is required (or use --all)');
        process.exitCode = 1;
        return;
      }

      if (options?.dryRun) {
        await this.runDryRun(projectName);
        return;
      }

      await this.runSingle(projectName);
    } catch (error) {
      this.handleError(error);
    }
  }

  // ── Dry run with detailed check output ────────────────────────────

  private async runDryRun(projectName: string): Promise<void> {
    console.log(`\n=== Dry Run: ${projectName} ===\n`);
    console.log('Validating config and connectivity without executing backup.\n');

    const report = await this.backupOrchestrator.executeDryRun(projectName);

    for (const check of report.checks) {
      const icon = check.passed ? '✅' : '❌';
      console.log(`  ${icon} ${check.name}`);
      console.log(`     ${check.message}`);
    }

    console.log('');
    if (report.allPassed) {
      console.log(`✅ All checks passed — ${projectName} is ready for backup.`);
    } else {
      const failed = report.checks.filter((c) => !c.passed).length;
      console.log(`❌ ${failed} check(s) failed — fix issues before running backup.`);
      process.exitCode = 4;
    }
    console.log('');
  }

  // ── Run single project ──────────────────────────────────────────────

  private async runSingle(projectName: string): Promise<void> {
    console.log(`Starting backup for ${projectName}...`);

    const result = await this.backupOrchestrator.runBackup(projectName);
    this.printResult(result);

    if (result.status === BackupStatus.Failed) {
      process.exitCode = 1;
    }
  }

  // ── Run all projects ────────────────────────────────────────────────

  private async runAll(): Promise<void> {
    console.log('Running backup for all enabled projects...\n');

    const results = await this.backupOrchestrator.runAllBackups();

    for (const result of results) {
      this.printResult(result);
    }

    const succeeded = results.filter((r) => r.status === BackupStatus.Success).length;
    const failed = results.filter((r) => r.status === BackupStatus.Failed).length;
    const allFailed = results.every((r) => r.status === BackupStatus.Failed);

    if (allFailed) {
      process.exitCode = 1;
    } else if (failed > 0) {
      process.exitCode = 5;
    }

    console.log(`\nSummary: ${succeeded} succeeded, ${failed} failed`);
  }

  // ── Output formatting ───────────────────────────────────────────────

  private printResult(result: BackupResult): void {
    const icon = result.status === BackupStatus.Success ? '✅' : '❌';
    const duration = formatDuration(result.durationMs);

    console.log(`${icon} ${result.projectName} — ${result.status} (${duration})`);

    if (result.dumpResult) {
      console.log(`   Dump: ${formatBytes(result.dumpResult.sizeBytes)} | Encrypted: ${result.encrypted ? 'Yes' : 'No'} | Verified: ${result.verified ? 'Yes' : 'No'}`);
    }

    if (result.syncResult) {
      console.log(`   Snapshot: ${result.syncResult.snapshotId} | New: ${result.syncResult.filesNew} | Changed: ${result.syncResult.filesChanged} | Added: ${formatBytes(result.syncResult.bytesAdded)}`);
    }

    if (result.errorMessage) {
      console.log(`   Error: ${result.errorMessage}`);
      if (result.errorStage) {
        console.log(`   Stage: ${result.errorStage} | Retries: ${result.retryCount}`);
      }
    }
  }

  private handleError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes('already in progress')) {
      process.exitCode = 2;
      console.error(`Error: ${message}`);
      return;
    }

    process.exitCode = 1;
    console.error(`Error: ${message}`);
  }
}
