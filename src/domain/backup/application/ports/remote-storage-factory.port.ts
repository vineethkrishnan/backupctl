import { ProjectConfig } from '@domain/config/domain/project-config.model';
import { RemoteStoragePort } from './remote-storage.port';

export interface RemoteStorageFactoryPort {
  create(config: ProjectConfig): RemoteStoragePort;
}
