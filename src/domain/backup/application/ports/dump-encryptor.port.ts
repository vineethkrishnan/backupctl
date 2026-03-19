export interface DumpEncryptorPort {
  encrypt(filePath: string, recipient?: string): Promise<string>;
  decrypt(filePath: string): Promise<string>;
}
