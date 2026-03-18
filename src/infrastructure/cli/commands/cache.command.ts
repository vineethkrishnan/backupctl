import { Command, CommandRunner, Option } from 'nest-commander';

import { CacheManagementService } from '@application/backup/cache-management.service';
import { formatBytes } from '@shared/format.util';

interface CacheOptions {
  clear?: boolean;
  clearAll?: boolean;
}

@Command({
  name: 'cache',
  description: 'Show or clear restic cache for a project',
  arguments: '[project]',
})
export class CacheCommand extends CommandRunner {
  constructor(
    private readonly cacheManagement: CacheManagementService,
  ) {
    super();
  }

  @Option({
    flags: '--clear',
    description: 'Clear cache for the specified project',
  })
  parseClear(): boolean {
    return true;
  }

  @Option({
    flags: '--clear-all',
    description: 'Clear cache for all projects',
  })
  parseClearAll(): boolean {
    return true;
  }

  async run(params: string[], options?: CacheOptions): Promise<void> {
    try {
      if (options?.clearAll) {
        await this.cacheManagement.clearAllCaches();
        console.log('All project caches cleared.');
        return;
      }

      const projectName = params[0];
      if (!projectName) {
        console.error('Error: project name is required (or use --clear-all)');
        process.exitCode = 1;
        return;
      }

      if (options?.clear) {
        await this.cacheManagement.clearCache(projectName);
        console.log(`Cache cleared for ${projectName}.`);
        return;
      }

      const info = await this.cacheManagement.getCacheInfo(projectName);
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
