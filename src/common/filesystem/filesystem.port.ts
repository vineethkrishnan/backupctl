export interface FileSystemPort {
  exists(filePath: string): boolean;
  diskFreeGb(dirPath: string): number;
  listDirectory(dirPath: string): string[];
  removeFile(filePath: string): void;
}
