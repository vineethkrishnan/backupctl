import { ProjectConfig } from '../../config/models/project-config.model';
import { RemoteStoragePort } from './remote-storage.port';

export interface RemoteStorageFactory {
  create(config: ProjectConfig): RemoteStoragePort;
}
