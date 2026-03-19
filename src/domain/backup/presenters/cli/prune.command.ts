import { Command, CommandRunner, Option } from 'nest-commander';
import { PruneBackupUseCase } from '@domain/backup/application/use-cases/prune-backup/prune-backup.use-case';
import { PruneBackupCommand } from '@domain/backup/application/use-cases/prune-backup/prune-backup.command';
import { PruneResult } from '@domain/backup/domain/value-objects/prune-result.model';

interface PruneOptions { all?: boolean; }

@Command({ name: 'prune', description: 'Prune old snapshots for a project or all projects', arguments: '[project]' })
export class PruneCommand extends CommandRunner {
  constructor(private readonly pruneBackup: PruneBackupUseCase) { super(); }

  @Option({ flags: '--all', description: 'Prune all enabled projects' })
  parseAll(): boolean { return true; }

  async run(params: string[], options?: PruneOptions): Promise<void> {
    try {
      if (options?.all) {
        console.log('Pruning all enabled projects...');
        const results = await this.pruneBackup.execute(new PruneBackupCommand({ isAll: true }));
        for (const result of results) { this.printResult(result); }
        return;
      }

      const projectName = params[0];
      if (!projectName) { console.error('Error: project name is required (or use --all)'); process.exitCode = 1; return; }

      console.log(`Pruning ${projectName}...`);
      const [result] = await this.pruneBackup.execute(new PruneBackupCommand({ projectName }));
      this.printResult(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      process.exitCode = 1;
    }
  }

  private printResult(result: PruneResult): void {
    console.log(`  Removed ${result.snapshotsRemoved} snapshot(s), freed ${result.spaceFreed}`);
  }
}
