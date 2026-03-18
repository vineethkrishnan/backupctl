import { Inject, Injectable } from '@nestjs/common';
import { CacheUseCase } from '@domain/backup/ports/cache.use-case';
import { CacheInfo } from '@domain/backup/models/cache-info.model';
import { ConfigLoaderPort } from '@domain/config/ports/config-loader.port';
import { RemoteStorageFactory } from '@domain/backup/ports/remote-storage-factory.port';
import { REMOTE_STORAGE_FACTORY, CONFIG_LOADER_PORT } from '@shared/injection-tokens';

@Injectable()
export class CacheManagementService implements CacheUseCase {
  constructor(
    @Inject(REMOTE_STORAGE_FACTORY) private readonly storageFactory: RemoteStorageFactory,
    @Inject(CONFIG_LOADER_PORT) private readonly configLoader: ConfigLoaderPort,
  ) {}

  async getCacheInfo(projectName: string): Promise<CacheInfo> {
    const config = this.configLoader.getProject(projectName);
    const storage = this.storageFactory.create(config);
    return storage.getCacheInfo();
  }

  async clearCache(projectName: string): Promise<void> {
    const config = this.configLoader.getProject(projectName);
    const storage = this.storageFactory.create(config);
    await storage.clearCache();
  }

  async clearAllCaches(): Promise<void> {
    const projects = this.configLoader.loadAll().filter((project) => project.enabled);

    for (const project of projects) {
      const storage = this.storageFactory.create(project);
      await storage.clearCache();
    }
  }
}
