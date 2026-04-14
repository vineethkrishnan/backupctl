import { DumpResult } from '@domain/backup/domain/value-objects/dump-result.model';

export interface DatabaseDumperPort {
  dump(outputDir: string, projectName: string, timestamp: string): Promise<DumpResult>;
  verify(filePath: string): Promise<boolean>;
  testConnection(): Promise<void>;
}
