import { CacheInfo } from '../models/cache-info.model';

export interface CacheUseCase {
  getCacheInfo(projectName: string): Promise<CacheInfo>;
  clearCache(projectName: string): Promise<void>;
  clearAllCaches(): Promise<void>;
}
