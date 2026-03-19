import { Inject, Injectable } from '@nestjs/common';
import { ConfigLoaderPort } from '@domain/config/application/ports/config-loader.port';
import { RemoteStorageFactory } from '@domain/backup/application/ports/remote-storage-factory.port';
import { REMOTE_STORAGE_FACTORY, CONFIG_LOADER_PORT } from '@common/di/injection-tokens';
import { ClearCacheCommand } from './clear-cache.command';

@Injectable()
export class ClearCacheUseCase {
  constructor(
    @Inject(REMOTE_STORAGE_FACTORY) private readonly storageFactory: RemoteStorageFactory,
    @Inject(CONFIG_LOADER_PORT) private readonly configLoader: ConfigLoaderPort,
  ) {}

  async execute(command: ClearCacheCommand): Promise<void> {
    if (command.clearAll) {
      const projects = this.configLoader.loadAll().filter((project) => project.enabled);
      for (const project of projects) {
        const storage = this.storageFactory.create(project);
        await storage.clearCache();
      }
      return;
    }

    if (!command.projectName) {
      throw new Error('projectName is required when clearAll is false');
    }

    const config = this.configLoader.getProject(command.projectName);
    const storage = this.storageFactory.create(config);
    await storage.clearCache();
  }
}
