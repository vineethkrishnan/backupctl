import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { ConfigLoaderPort, ValidationResult } from '@domain/config/application/ports/config-loader.port';
import { ProjectConfig } from '@domain/config/domain/project-config.model';
import { RetentionPolicy } from '@domain/config/domain/retention-policy.model';
import {
  REQUIRED_STORAGE_CONFIG_KEYS,
  SNAPSHOT_MODES,
  STORAGE_BACKEND_TYPES,
  SnapshotMode,
  StorageBackendType,
} from '@domain/config/domain/storage-config.model';

interface RawProjectEntry {
  name: string;
  enabled?: boolean;
  cron: string;
  timeout_minutes?: number;
  docker_network?: string;
  database?: {
    type: string;
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
    dump_timeout_minutes?: number;
  };
  compression?: { enabled?: boolean };
  assets?: { paths?: string[] };
  storage?: {
    type?: string;
    repository?: string;
    password?: string;
    snapshot_mode?: string;
    config?: Record<string, string>;
  };
  /** @deprecated Use `storage` with `type: sftp`. Normalized away at load time. */
  restic?: {
    repository_path: string;
    password?: string;
    snapshot_mode?: string;
  };
  retention: {
    local_days: number;
    keep_daily: number;
    keep_weekly: number;
    keep_monthly?: number;
  };
  encryption?: {
    enabled?: boolean;
    type?: string;
    recipient?: string;
  };
  hooks?: {
    pre_backup?: string;
    post_backup?: string;
  };
  verification?: { enabled?: boolean };
  notification?: {
    type: string;
    config: Record<string, unknown>;
  };
  monitor?: {
    type: string;
    config: Record<string, unknown>;
  };
}

interface RawYamlConfig {
  projects: RawProjectEntry[];
}

@Injectable()
export class YamlConfigLoaderAdapter implements ConfigLoaderPort {
  private readonly logger = new Logger(YamlConfigLoaderAdapter.name);
  private projects: ProjectConfig[] | null = null;
  private readonly warnedLegacyProjects = new Set<string>();
  private readonly configPath: string;

  constructor(private readonly configService: ConfigService) {
    this.configPath = path.resolve('config/projects.yml');
  }

  loadAll(): ProjectConfig[] {
    const fileContent = fs.readFileSync(this.configPath, 'utf8');
    const raw = yaml.load(fileContent) as RawYamlConfig;

    if (!raw?.projects || !Array.isArray(raw.projects)) {
      throw new Error('Invalid config: "projects" array is required in projects.yml');
    }

    this.projects = raw.projects.map((entry) => this.buildProjectConfig(entry));
    return this.projects;
  }

  getProject(name: string): ProjectConfig {
    const projects = this.projects ?? this.loadAll();
    const project = projects.find((p) => p.name === name);

    if (!project) {
      throw new Error(`Project "${name}" not found in configuration`);
    }

    return project;
  }

  validate(): ValidationResult {
    const errors: string[] = [];

    try {
      const fileContent = fs.readFileSync(this.configPath, 'utf8');
      const raw = yaml.load(fileContent) as RawYamlConfig;

      if (!raw?.projects || !Array.isArray(raw.projects)) {
        return { isValid: false, errors: ['"projects" array is required in projects.yml'] };
      }

      for (const entry of raw.projects) {
        const resolved = this.resolveEnvVarsInObject(
          entry as unknown as Record<string, unknown>,
        ) as unknown as RawProjectEntry;

        const unresolvedVars = this.findUnresolvedVars(resolved as unknown as Record<string, unknown>);
        for (const varName of unresolvedVars) {
          errors.push(`Project "${entry.name}": unresolved variable \${${varName}}`);
        }

        if (!resolved.name) {
          errors.push('Project missing required field: name');
        }
        if (!resolved.cron) {
          errors.push(`Project "${resolved.name}": missing required field: cron`);
        }
        const hasDb = !!resolved.database;
        const hasAssets = Array.isArray(resolved.assets?.paths) && resolved.assets.paths.length > 0;
        if (!hasDb && !hasAssets) {
          errors.push(`Project "${resolved.name}": must have at least one of "database" or "assets"`);
        }
        errors.push(...this.validateStorage(resolved));

        if (!resolved.retention) {
          errors.push(`Project "${resolved.name}": missing required field: retention`);
        }

        if (resolved.cron) {
          const cronParts = resolved.cron.trim().split(/\s+/);
          if (cronParts.length !== 5) {
            errors.push(
              `Project "${resolved.name}": invalid cron expression "${resolved.cron}" (expected 5 fields)`,
            );
          }
        }

        if (resolved.monitor) {
          if (!resolved.monitor.type) {
            errors.push(`Project "${resolved.name}": monitor missing required field: type`);
          }
          if (resolved.monitor.type === 'uptime-kuma') {
            const pushToken = resolved.monitor.config?.push_token;
            if (!pushToken) {
              errors.push(`Project "${resolved.name}": monitor type "uptime-kuma" requires config.push_token`);
            }
            const kumaBaseUrl = this.configService.get<string>('UPTIME_KUMA_BASE_URL');
            if (!kumaBaseUrl) {
              errors.push(`Project "${resolved.name}": monitor type "uptime-kuma" requires UPTIME_KUMA_BASE_URL in .env`);
            }
          }
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to load config: ${message}`);
    }

    return { isValid: errors.length === 0, errors };
  }

  private validateStorage(entry: RawProjectEntry): string[] {
    const errors: string[] = [];
    const project = `Project "${entry.name}"`;

    if (entry.restic && entry.storage) {
      errors.push(`${project}: has both "restic" and "storage" — keep only "storage"`);
      return errors;
    }

    const storage = entry.storage ?? this.legacyStorageView(entry);

    if (!storage) {
      errors.push(`${project}: missing required field: storage`);
      return errors;
    }

    const type = storage.type ?? 'sftp';
    if (!STORAGE_BACKEND_TYPES.includes(type as StorageBackendType)) {
      errors.push(
        `${project}: invalid storage type "${type}" (expected one of: ${STORAGE_BACKEND_TYPES.join(', ')})`,
      );
      return errors;
    }

    if (!storage.repository) {
      errors.push(`${project}: storage missing required field: repository`);
    }

    if (storage.snapshot_mode && !SNAPSHOT_MODES.includes(storage.snapshot_mode as SnapshotMode)) {
      errors.push(
        `${project}: invalid snapshot_mode "${storage.snapshot_mode}" ` +
          `(expected one of: ${SNAPSHOT_MODES.join(', ')})`,
      );
    }

    for (const key of REQUIRED_STORAGE_CONFIG_KEYS[type as StorageBackendType]) {
      if (!storage.config?.[key]) {
        errors.push(`${project}: storage type "${type}" requires config.${key}`);
      }
    }

    if (type === 'sftp') {
      for (const key of ['HETZNER_SSH_HOST', 'HETZNER_SSH_USER', 'HETZNER_SSH_KEY_PATH']) {
        if (!this.configService.get<string>(key)) {
          errors.push(`${project}: storage type "sftp" requires ${key} in .env`);
        }
      }
    }

    if (!storage.password && !this.configService.get<string>('RESTIC_PASSWORD')) {
      errors.push(`${project}: storage requires a password, or RESTIC_PASSWORD in .env`);
    }

    return errors;
  }

  private legacyStorageView(entry: RawProjectEntry): RawProjectEntry['storage'] | null {
    if (!entry.restic) return null;

    return {
      type: 'sftp',
      repository: entry.restic.repository_path,
      password: entry.restic.password,
      snapshot_mode: entry.restic.snapshot_mode,
    };
  }

  reload(): void {
    this.logger.log('Reloading project configuration');
    this.projects = null;
    this.warnedLegacyProjects.clear();
    this.loadAll();
  }

  private resolveEnvVar(value: string): string {
    return value.replace(/\$\{([^}]+)}/g, (_match, varName: string) => {
      const envValue = process.env[varName];
      if (envValue === undefined) {
        throw new Error(`Environment variable "${varName}" is not set`);
      }
      return envValue;
    });
  }

  private resolveEnvVarsInObject(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        result[key] = this.resolveEnvVar(value);
      } else if (Array.isArray(value)) {
        result[key] = value.map((item) => {
          if (typeof item === 'string') {
            return this.resolveEnvVar(item);
          }
          if (typeof item === 'object' && item !== null) {
            return this.resolveEnvVarsInObject(item as Record<string, unknown>);
          }
          return item as unknown;
        });
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.resolveEnvVarsInObject(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  private findUnresolvedVars(obj: Record<string, unknown>): string[] {
    const unresolved: string[] = [];

    const traverse = (value: unknown): void => {
      if (typeof value === 'string') {
        const pattern = /\$\{([^}]+)}/g;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(value)) !== null) {
          unresolved.push(match[1]);
        }
      } else if (Array.isArray(value)) {
        for (const item of value) {
          traverse(item);
        }
      } else if (typeof value === 'object' && value !== null) {
        for (const val of Object.values(value)) {
          traverse(val);
        }
      }
    };

    traverse(obj);
    return unresolved;
  }

  private applyFallbacks(entry: RawProjectEntry): void {
    if (!entry.notification) {
      const notificationType = this.configService.get<string>('NOTIFICATION_TYPE');
      if (notificationType) {
        entry.notification = {
          type: notificationType,
          config: {},
        };

        if (notificationType === 'slack') {
          const webhookUrl = this.configService.get<string>('SLACK_WEBHOOK_URL');
          if (webhookUrl) {
            entry.notification.config = { webhook_url: webhookUrl };
          }
        }
      }
    }

    if (!entry.encryption) {
      const encryptionEnabled = this.configService.get<string>('ENCRYPTION_ENABLED');
      if (encryptionEnabled === 'true') {
        entry.encryption = {
          enabled: true,
          type: this.configService.get<string>('ENCRYPTION_TYPE', 'gpg'),
          recipient: this.configService.get<string>('GPG_RECIPIENT', ''),
        };
      }
    }

    if (entry.storage) {
      entry.storage.password ??= this.configService.get<string>('RESTIC_PASSWORD') ?? undefined;
    }

    if (!entry.compression) {
      entry.compression = { enabled: true };
    } else {
      entry.compression.enabled ??= true;
    }
  }

  /**
   * Maps the deprecated `restic:` block onto `storage:` with `type: sftp`.
   * Remove once no deployment carries a legacy config.
   */
  private normalizeLegacyStorage(entry: RawProjectEntry): void {
    const legacyStorage = this.legacyStorageView(entry);
    if (!legacyStorage || entry.storage) return;

    // loadAll() re-reads the file on every call, and callers include the health probe
    // on a 5-minute timer — warn once per project rather than forever.
    if (!this.warnedLegacyProjects.has(entry.name)) {
      this.warnedLegacyProjects.add(entry.name);
      this.logger.warn(
        `Project "${entry.name}": the "restic" config block is deprecated — rename it to "storage" ` +
          'with "type: sftp" and "repository" in place of "repository_path".',
      );
    }

    entry.storage = legacyStorage;
  }

  private buildProjectConfig(raw: RawProjectEntry): ProjectConfig {
    const resolved = this.resolveEnvVarsInObject(
      raw as unknown as Record<string, unknown>,
    ) as unknown as RawProjectEntry;

    this.normalizeLegacyStorage(resolved);
    this.applyFallbacks(resolved);

    if (!resolved.storage) {
      throw new Error(`Project "${resolved.name}": missing required field: storage`);
    }

    const retention = new RetentionPolicy(
      resolved.retention.local_days,
      resolved.retention.keep_daily,
      resolved.retention.keep_weekly ?? 0,
      resolved.retention.keep_monthly ?? 0,
    );

    return new ProjectConfig({
      name: resolved.name,
      enabled: resolved.enabled ?? true,
      cron: resolved.cron,
      timeoutMinutes: resolved.timeout_minutes ?? null,
      dockerNetwork: resolved.docker_network ?? null,
      database: resolved.database
        ? {
            type: resolved.database.type,
            host: resolved.database.host,
            port: resolved.database.port,
            name: resolved.database.name,
            user: resolved.database.user,
            password: resolved.database.password,
            dumpTimeoutMinutes: resolved.database.dump_timeout_minutes ?? null,
          }
        : null,
      compression: { enabled: resolved.compression?.enabled ?? true },
      assets: { paths: resolved.assets?.paths ?? [] },
      storage: {
        type: (resolved.storage.type as StorageBackendType) ?? 'sftp',
        repository: resolved.storage.repository ?? '',
        password: resolved.storage.password ?? '',
        snapshotMode: (resolved.storage.snapshot_mode as SnapshotMode) ?? 'combined',
        config: resolved.storage.config ?? {},
      },
      retention,
      encryption: resolved.encryption
        ? {
            enabled: resolved.encryption.enabled ?? false,
            type: resolved.encryption.type ?? 'gpg',
            recipient: resolved.encryption.recipient ?? '',
          }
        : null,
      hooks: resolved.hooks
        ? {
            preBackup: resolved.hooks.pre_backup ?? null,
            postBackup: resolved.hooks.post_backup ?? null,
          }
        : null,
      verification: { enabled: resolved.verification?.enabled ?? false },
      notification: resolved.notification ?? null,
      monitor: resolved.monitor ?? null,
    });
  }
}
