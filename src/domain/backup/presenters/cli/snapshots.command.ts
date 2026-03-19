import { Command, CommandRunner, Option } from 'nest-commander';
import { ListSnapshotsUseCase } from '@domain/backup/application/use-cases/list-snapshots/list-snapshots.use-case';

interface SnapshotsOptions { last?: number; }

@Command({ name: 'snapshots', description: 'List snapshots for a project', arguments: '<project>' })
export class SnapshotsCommand extends CommandRunner {
  constructor(private readonly listSnapshots: ListSnapshotsUseCase) { super(); }

  @Option({ flags: '--last <n>', description: 'Show last N snapshots' })
  parseLast(value: string): number { return parseInt(value, 10); }

  async run(params: string[], options?: SnapshotsOptions): Promise<void> {
    const projectName = params[0];

    try {
      const snapshots = await this.listSnapshots.execute(
        { projectName, limit: options?.last } as import('@domain/backup/application/use-cases/list-snapshots/list-snapshots.query').ListSnapshotsQuery,
      );

      if (snapshots.length === 0) { console.log(`No snapshots found for ${projectName}.`); return; }

      console.log(`Snapshots for ${projectName}:\n`);
      console.log('ID'.padEnd(12) + 'Time'.padEnd(28) + 'Size'.padEnd(12) + 'Tags');
      console.log('─'.repeat(72));

      for (const snapshot of snapshots) {
        console.log(
          `${snapshot.id.substring(0, 10).padEnd(12)}` +
            `${snapshot.time.padEnd(28)}` +
            `${snapshot.size.padEnd(12)}` +
            `${snapshot.tags.join(', ')}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      process.exitCode = 1;
    }
  }
}
