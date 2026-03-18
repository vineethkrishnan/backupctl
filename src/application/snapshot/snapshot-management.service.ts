import { Inject, Injectable } from '@nestjs/common';
import { SnapshotUseCase } from '@domain/backup/ports/snapshot.use-case';
import { SnapshotInfo } from '@domain/backup/models/snapshot-info.model';
import { ConfigLoaderPort } from '@domain/config/ports/config-loader.port';
import { RemoteStorageFactory } from '@domain/backup/ports/remote-storage-factory.port';
import { REMOTE_STORAGE_FACTORY, CONFIG_LOADER_PORT } from '@shared/injection-tokens';

@Injectable()
export class SnapshotManagementService implements SnapshotUseCase {
  constructor(
    @Inject(REMOTE_STORAGE_FACTORY) private readonly storageFactory: RemoteStorageFactory,
    @Inject(CONFIG_LOADER_PORT) private readonly configLoader: ConfigLoaderPort,
  ) {}

  async listSnapshots(projectName: string, limit?: number): Promise<SnapshotInfo[]> {
    const config = this.configLoader.getProject(projectName);
    const storage = this.storageFactory.create(config);
    const snapshots = await storage.listSnapshots();

    if (limit !== undefined) {
      return snapshots.slice(0, limit);
    }

    return snapshots;
  }
}
