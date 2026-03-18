import { Command, CommandRunner, Option } from 'nest-commander';

import { BackupOrchestratorService } from '@application/backup/backup-orchestrator.service';

interface RestoreOptions {
  only?: 'db' | 'assets';
  decompress?: boolean;
  guide?: boolean;
}

@Command({
  name: 'restore',
  description: 'Restore a backup from a snapshot',
  arguments: '<project> <snapshot> <path>',
})
export class RestoreCommand extends CommandRunner {
  constructor(
    private readonly backupOrchestrator: BackupOrchestratorService,
  ) {
    super();
  }

  @Option({
    flags: '--only <type>',
    description: 'Restore only db or assets',
  })
  parseOnly(value: string): 'db' | 'assets' {
    if (value !== 'db' && value !== 'assets') {
      throw new Error('--only must be "db" or "assets"');
    }
    return value;
  }

  @Option({
    flags: '--decompress',
    description: 'Decompress files after restore',
  })
  parseDecompress(): boolean {
    return true;
  }

  @Option({
    flags: '--guide',
    description: 'Print restore guide instead of restoring',
  })
  parseGuide(): boolean {
    return true;
  }

  async run(params: string[], options?: RestoreOptions): Promise<void> {
    const [projectName, snapshotId, targetPath] = params;

    try {
      if (options?.guide) {
        const guide = this.backupOrchestrator.getRestoreGuide(projectName);
        console.log(guide);
        return;
      }

      console.log(
        `Restoring ${projectName} from snapshot ${snapshotId} to ${targetPath}...`,
      );

      await this.backupOrchestrator.restoreBackup(projectName, snapshotId, targetPath, {
        only: options?.only,
        decompress: options?.decompress,
      });

      console.log('Restore completed successfully.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      process.exitCode = 1;
    }
  }
}
