import { Inject, Injectable } from '@nestjs/common';
import { ConfigLoaderPort } from '@domain/config/application/ports/config-loader.port';
import { RemoteStorageFactoryPort } from '@domain/backup/application/ports/remote-storage-factory.port';
import { CacheInfo } from '@domain/backup/domain/value-objects/cache-info.model';
import { REMOTE_STORAGE_FACTORY, CONFIG_LOADER_PORT } from '@common/di/injection-tokens';
import { GetCacheInfoQuery } from './get-cache-info.query';

@Injectable()
export class GetCacheInfoUseCase {
  constructor(
    @Inject(REMOTE_STORAGE_FACTORY) private readonly storageFactory: RemoteStorageFactoryPort,
    @Inject(CONFIG_LOADER_PORT) private readonly configLoader: ConfigLoaderPort,
  ) {}

  async execute(query: GetCacheInfoQuery): Promise<CacheInfo> {
    const config = this.configLoader.getProject(query.projectName);
    const storage = this.storageFactory.create(config);
    return storage.getCacheInfo();
  }
}
