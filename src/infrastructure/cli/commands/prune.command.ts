import { Command, CommandRunner, Option } from 'nest-commander';

import { BackupOrchestratorService } from '@application/backup/backup-orchestrator.service';
import { PruneResult } from '@domain/backup/models/prune-result.model';

interface PruneOptions {
  all?: boolean;
}

@Command({
  name: 'prune',
  description: 'Prune old snapshots for a project or all projects',
  arguments: '[project]',
})
export class PruneCommand extends CommandRunner {
  constructor(
    private readonly backupOrchestrator: BackupOrchestratorService,
  ) {
    super();
  }

  @Option({
    flags: '--all',
    description: 'Prune all enabled projects',
  })
  parseAll(): boolean {
    return true;
  }

  async run(params: string[], options?: PruneOptions): Promise<void> {
    try {
      if (options?.all) {
        console.log('Pruning all enabled projects...');
        const results = await this.backupOrchestrator.pruneAll();

        for (const result of results) {
          this.printResult(result);
        }
        return;
      }

      const projectName = params[0];
      if (!projectName) {
        console.error('Error: project name is required (or use --all)');
        process.exitCode = 1;
        return;
      }

      console.log(`Pruning ${projectName}...`);
      const result = await this.backupOrchestrator.pruneProject(projectName);
      this.printResult(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      process.exitCode = 1;
    }
  }

  private printResult(result: PruneResult): void {
    console.log(
      `  Removed ${result.snapshotsRemoved} snapshot(s), freed ${result.spaceFreed}`,
    );
  }
}
