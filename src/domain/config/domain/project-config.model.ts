import { RetentionPolicy } from './retention-policy.model';

export interface ProjectConfigParams {
  readonly name: string;
  readonly enabled: boolean;
  readonly cron: string;
  readonly timeoutMinutes: number | null;
  readonly dockerNetwork?: string | null;
  readonly database: {
    readonly type: string;
    readonly host: string;
    readonly port: number;
    readonly name: string;
    readonly user: string;
    readonly password: string;
  } | null;
  readonly compression: { readonly enabled: boolean };
  readonly assets: { readonly paths: readonly string[] };
  readonly restic: {
    readonly repositoryPath: string;
    readonly password: string;
    readonly snapshotMode: 'combined' | 'separate';
  };
  readonly retention: RetentionPolicy;
  readonly encryption: { readonly enabled: boolean; readonly type: string; readonly recipient: string } | null;
  readonly hooks: { readonly preBackup: string | null; readonly postBackup: string | null } | null;
  readonly verification: { readonly enabled: boolean };
  readonly notification: { readonly type: string; readonly config: Record<string, unknown> } | null;
  readonly monitor: { readonly type: string; readonly config: Record<string, unknown> } | null;
}

export class ProjectConfig {
  readonly name: string;
  readonly enabled: boolean;
  readonly cron: string;
  readonly timeoutMinutes: number | null;
  readonly dockerNetwork: string | null;
  readonly database: {
    readonly type: string;
    readonly host: string;
    readonly port: number;
    readonly name: string;
    readonly user: string;
    readonly password: string;
  } | null;
  readonly compression: { readonly enabled: boolean };
  readonly assets: { readonly paths: readonly string[] };
  readonly restic: {
    readonly repositoryPath: string;
    readonly password: string;
    readonly snapshotMode: 'combined' | 'separate';
  };
  readonly retention: RetentionPolicy;
  readonly encryption: {
    readonly enabled: boolean;
    readonly type: string;
    readonly recipient: string;
  } | null;
  readonly hooks: { readonly preBackup: string | null; readonly postBackup: string | null } | null;
  readonly verification: { readonly enabled: boolean };
  readonly notification: { readonly type: string; readonly config: Record<string, unknown> } | null;
  readonly monitor: { readonly type: string; readonly config: Record<string, unknown> } | null;

  constructor(params: ProjectConfigParams) {
    this.name = params.name;
    this.enabled = params.enabled;
    this.cron = params.cron;
    this.timeoutMinutes = params.timeoutMinutes;
    this.dockerNetwork = params.dockerNetwork ?? null;
    this.database = params.database;
    this.compression = params.compression;
    this.assets = params.assets;
    this.restic = params.restic;
    this.retention = params.retention;
    this.encryption = params.encryption;
    this.hooks = params.hooks;
    this.verification = params.verification;
    this.notification = params.notification;
    this.monitor = params.monitor ?? null;
  }

  hasDatabase(): boolean {
    return this.database != null;
  }

  hasEncryption(): boolean {
    return (this.encryption?.enabled) ?? false;
  }

  hasHooks(): boolean {
    return this.hooks != null && (this.hooks.preBackup != null || this.hooks.postBackup != null);
  }

  hasVerification(): boolean {
    return this.verification.enabled;
  }

  hasAssets(): boolean {
    return this.assets.paths.length > 0;
  }

  hasTimeout(): boolean {
    return this.timeoutMinutes != null && this.timeoutMinutes > 0;
  }

  hasMonitor(): boolean {
    return this.monitor != null;
  }
}
