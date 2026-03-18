import { SnapshotInfo } from '../models/snapshot-info.model';

export interface SnapshotUseCase {
  listSnapshots(projectName: string, limit?: number): Promise<SnapshotInfo[]>;
}
