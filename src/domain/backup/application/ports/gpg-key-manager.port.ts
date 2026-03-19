export interface GpgKeyManagerPort {
  importKey(filePath: string): Promise<void>;
  importAllFromDirectory(): Promise<string[]>;
  listKeys(): Promise<string>;
  hasKey(recipient: string): Promise<boolean>;
}
