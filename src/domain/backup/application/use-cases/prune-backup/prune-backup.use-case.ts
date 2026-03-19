import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigLoaderPort } from '@domain/config/application/ports/config-loader.port';
import { RemoteStorageFactory } from '@domain/backup/application/ports/remote-storage-factory.port';
import { PruneResult } from '@domain/backup/domain/value-objects/prune-result.model';
import { CONFIG_LOADER_PORT, REMOTE_STORAGE_FACTORY } from '@common/di/injection-tokens';
import { PruneBackupCommand } from './prune-backup.command';

@Injectable()
export class PruneBackupUseCase {
  private readonly logger = new Logger(PruneBackupUseCase.name);

  constructor(
    @Inject(CONFIG_LOADER_PORT) private readonly configLoader: ConfigLoaderPort,
    @Inject(REMOTE_STORAGE_FACTORY) private readonly storageFactory: RemoteStorageFactory,
  ) {}

  async execute(command: PruneBackupCommand): Promise<PruneResult[]> {
    if (command.isAll) {
      return this.pruneAll();
    }

    if (!command.projectName) {
      throw new Error('Either projectName or isAll must be provided');
    }

    const result = await this.pruneSingle(command.projectName);
    return [result];
  }

  private async pruneSingle(projectName: string): Promise<PruneResult> {
    const config = this.configLoader.getProject(projectName);
    const storage = this.storageFactory.create(config);
    return storage.prune(config.retention);
  }

  private async pruneAll(): Promise<PruneResult[]> {
    const projects = this.configLoader.loadAll().filter((project) => project.enabled);
    const results: PruneResult[] = [];

    for (const project of projects) {
      try {
        const result = await this.pruneSingle(project.name);
        results.push(result);
      } catch (error) {
        this.logger.error(`Prune failed for ${project.name}: ${(error as Error).message}`);
      }
    }

    return results;
  }
}
