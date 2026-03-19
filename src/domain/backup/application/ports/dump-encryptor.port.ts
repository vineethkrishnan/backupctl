export interface DumpEncryptorPort {
  encrypt(filePath: string): Promise<string>;
  decrypt(filePath: string): Promise<string>;
}
