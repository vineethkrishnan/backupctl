import { Inject, Injectable } from '@nestjs/common';
import { SnapshotInfo } from '@domain/backup/domain/value-objects/snapshot-info.model';
import { ConfigLoaderPort } from '@domain/config/application/ports/config-loader.port';
import { RemoteStorageFactoryPort } from '@domain/backup/application/ports/remote-storage-factory.port';
import { REMOTE_STORAGE_FACTORY, CONFIG_LOADER_PORT } from '@common/di/injection-tokens';
import { ListSnapshotsQuery } from './list-snapshots.query';

@Injectable()
export class ListSnapshotsUseCase {
  constructor(
    @Inject(REMOTE_STORAGE_FACTORY) private readonly storageFactory: RemoteStorageFactoryPort,
    @Inject(CONFIG_LOADER_PORT) private readonly configLoader: ConfigLoaderPort,
  ) {}

  async execute(query: ListSnapshotsQuery): Promise<SnapshotInfo[]> {
    const config = this.configLoader.getProject(query.projectName);
    const storage = this.storageFactory.create(config);
    const snapshots = await storage.listSnapshots();

    if (query.limit !== undefined) {
      return snapshots.slice(0, query.limit);
    }

    return snapshots;
  }
}
