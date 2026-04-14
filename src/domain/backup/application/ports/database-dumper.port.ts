import { DumpResult } from '@domain/backup/domain/value-objects/dump-result.model';

export interface DumpOptions {
  readonly timeoutMs?: number;
}

export interface DatabaseDumperPort {
  dump(outputDir: string, projectName: string, timestamp: string, options?: DumpOptions): Promise<DumpResult>;
  verify(filePath: string): Promise<boolean>;
  testConnection(): Promise<void>;
}
