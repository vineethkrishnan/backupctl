export interface BackupLockPort {
  acquire(projectName: string): Promise<boolean>;
  acquireOrQueue(projectName: string): Promise<void>;
  release(projectName: string): Promise<void>;
  isLocked(projectName: string): boolean;
}
