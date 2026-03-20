import * as fs from 'fs';
import * as path from 'path';
import { Injectable } from '@nestjs/common';
import { FileSystemPort } from './filesystem.port';

@Injectable()
export class LocalFilesystemAdapter implements FileSystemPort {
  exists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }

  diskFreeGb(dirPath: string): number {
    const stats = fs.statfsSync(dirPath);
    return (stats.bsize * stats.bavail) / (1024 * 1024 * 1024);
  }

  listDirectory(dirPath: string): string[] {
    if (!fs.existsSync(dirPath)) return [];
    return fs.readdirSync(dirPath);
  }

  removeFile(filePath: string): void {
    const resolved = path.resolve(filePath);
    if (resolved.includes('..') || resolved.includes('\0')) {
      throw new Error(`Path traversal detected: ${filePath}`);
    }
    fs.unlinkSync(resolved);
  }
}
