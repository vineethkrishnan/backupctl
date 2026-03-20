import * as path from 'path';

import { RemoteStoragePort, SyncOptions } from '@domain/backup/application/ports/remote-storage.port';
import { CacheInfo } from '@domain/backup/domain/value-objects/cache-info.model';
import { PruneResult } from '@domain/backup/domain/value-objects/prune-result.model';
import { RetentionPolicy } from '@domain/config/domain/retention-policy.model';
import { SnapshotInfo } from '@domain/backup/domain/value-objects/snapshot-info.model';
import { SyncResult } from '@domain/backup/domain/value-objects/sync-result.model';
import { safeExecFile } from '@common/helpers/child-process.util';

interface ResticSummary {
  snapshot_id: string;
  files_new: number;
  files_changed: number;
  data_added: number;
  total_duration: number;
}

interface ResticSnapshot {
  id: string;
  short_id: string;
  time: string;
  paths: string[];
  hostname: string;
  tags: string[] | null;
  size?: string;
}

interface ResticForgetGroup {
  keep: ResticSnapshot[] | null;
  remove: ResticSnapshot[] | null;
}

export class ResticStorageAdapter implements RemoteStoragePort {
  private readonly repository: string;

  private readonly sshCommand: string;

  constructor(
    repositoryPath: string,
    private readonly password: string,
    sshHost: string,
    sshUser: string,
    sshKeyPath: string,
    private readonly projectName: string,
    sshPort = 22,
  ) {
    this.repository = `sftp:${sshUser}@${sshHost}:${repositoryPath}`;
    this.sshCommand = `ssh -i "${sshKeyPath}" -p ${sshPort} -o StrictHostKeyChecking=accept-new`;
  }

  async sync(paths: string[], options: SyncOptions): Promise<SyncResult> {
    const args = ['backup', ...paths];

    for (const tag of options.tags) {
      args.push('--tag', tag);
    }

    args.push('--json');

    const startTime = Date.now();
    const { stdout } = await safeExecFile('restic', args, { env: this.getEnv() });
    const durationMs = Date.now() - startTime;

    const summary = this.parseSyncOutput(stdout);

    return new SyncResult(
      summary.snapshot_id,
      summary.files_new,
      summary.files_changed,
      summary.data_added,
      durationMs,
    );
  }

  async prune(retention: RetentionPolicy): Promise<PruneResult> {
    const args = [
      'forget',
      '--prune',
      '--tag', `project:${this.projectName}`,
      '--keep-daily', String(retention.keepDaily),
      '--keep-weekly', String(retention.keepWeekly),
    ];

    if (retention.keepMonthly > 0) {
      args.push('--keep-monthly', String(retention.keepMonthly));
    }

    args.push('--json');

    const { stdout } = await safeExecFile('restic', args, { env: this.getEnv() });
    const parsed = JSON.parse(stdout) as ResticForgetGroup[];

    const totalRemoved = parsed.reduce((sum, group) => sum + (group.remove?.length ?? 0), 0);

    return new PruneResult(totalRemoved, '');
  }

  async listSnapshots(): Promise<SnapshotInfo[]> {
    const { stdout } = await safeExecFile('restic', ['snapshots', '--json'], {
      env: this.getEnv(),
    });

    const snapshots = JSON.parse(stdout) as ResticSnapshot[];

    return snapshots.map(
      (snapshot) =>
        new SnapshotInfo(
          snapshot.id,
          snapshot.time,
          snapshot.paths,
          snapshot.hostname,
          snapshot.tags ?? [],
          snapshot.size ?? '',
        ),
    );
  }

  async restore(
    snapshotId: string,
    targetPath: string,
    includePaths?: string[],
  ): Promise<void> {
    const args = ['restore', snapshotId, '--target', targetPath];

    if (includePaths) {
      for (const includePath of includePaths) {
        args.push('--include', includePath);
      }
    }

    await safeExecFile('restic', args, { env: this.getEnv() });
  }

  async exec(args: string[]): Promise<string> {
    const { stdout } = await safeExecFile('restic', args, { env: this.getEnv() });
    return stdout;
  }

  async getCacheInfo(): Promise<CacheInfo> {
    const homeDir = process.env.HOME ?? '/root';
    const cachePath = path.join(homeDir, '.cache', 'restic');

    let cacheSizeBytes = 0;
    try {
      const { stdout } = await safeExecFile('du', ['-sb', cachePath], { timeout: 30000 });
      const sizeStr = stdout.trim().split('\t')[0];
      cacheSizeBytes = parseInt(sizeStr, 10) || 0;
    } catch {
      cacheSizeBytes = 0;
    }

    return new CacheInfo(this.projectName, cacheSizeBytes, cachePath);
  }

  async clearCache(): Promise<void> {
    await safeExecFile('restic', ['cache', '--cleanup'], { env: this.getEnv() });
  }

  async unlock(): Promise<void> {
    await safeExecFile('restic', ['unlock'], { env: this.getEnv() });
  }

  private getEnv(): Record<string, string> {
    return {
      RESTIC_REPOSITORY: this.repository,
      RESTIC_PASSWORD: this.password,
      RESTIC_SSH_COMMAND: this.sshCommand,
    };
  }

  private parseSyncOutput(stdout: string): ResticSummary {
    if (!stdout.trim()) {
      throw new Error('Restic backup produced no output — check repository access and credentials');
    }

    const lines = stdout.trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (parsed.message_type === 'summary') {
        return {
          snapshot_id: parsed.snapshot_id as string,
          files_new: parsed.files_new as number,
          files_changed: parsed.files_changed as number,
          data_added: parsed.data_added as number,
          total_duration: parsed.total_duration as number,
        };
      }
    }

    throw new Error('No summary message found in restic backup output');
  }
}
