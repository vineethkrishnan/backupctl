import { Command, CommandRunner, Option } from 'nest-commander';
import { GetCacheInfoUseCase } from '@domain/backup/application/use-cases/get-cache-info/get-cache-info.use-case';
import { GetCacheInfoQuery } from '@domain/backup/application/use-cases/get-cache-info/get-cache-info.query';
import { ClearCacheUseCase } from '@domain/backup/application/use-cases/clear-cache/clear-cache.use-case';
import { ClearCacheCommand } from '@domain/backup/application/use-cases/clear-cache/clear-cache.command';
import { formatBytes } from '@common/helpers/format.util';

interface CacheOptions { clear?: boolean; clearAll?: boolean; }

@Command({ name: 'cache', description: 'Show or clear restic cache for a project', arguments: '[project]' })
export class CacheCommand extends CommandRunner {
  constructor(
    private readonly getCacheInfo: GetCacheInfoUseCase,
    private readonly clearCache: ClearCacheUseCase,
  ) { super(); }

  @Option({ flags: '--clear', description: 'Clear cache for the specified project' })
  parseClear(): boolean { return true; }

  @Option({ flags: '--clear-all', description: 'Clear cache for all projects' })
  parseClearAll(): boolean { return true; }

  async run(params: string[], options?: CacheOptions): Promise<void> {
    try {
      if (options?.clearAll) {
        await this.clearCache.execute(new ClearCacheCommand({ clearAll: true }));
        console.log('All project caches cleared.');
        return;
      }

      const projectName = params[0];
      if (!projectName) { console.error('Error: project name is required (or use --clear-all)'); process.exitCode = 1; return; }

      if (options?.clear) {
        await this.clearCache.execute(new ClearCacheCommand({ projectName }));
        console.log(`Cache cleared for ${projectName}.`);
        return;
      }

      const info = await this.getCacheInfo.execute(new GetCacheInfoQuery({ projectName }));
      console.log(`Cache for ${info.projectName}:`);
      console.log(`  Path: ${info.cachePath}`);
      console.log(`  Size: ${formatBytes(info.cacheSizeBytes)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      process.exitCode = 1;
    }
  }
}
