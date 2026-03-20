import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { ConfigLoaderPort, ValidationResult } from '@domain/config/application/ports/config-loader.port';
import { ProjectConfig } from '@domain/config/domain/project-config.model';
import { RetentionPolicy } from '@domain/config/domain/retention-policy.model';

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
  };
  compression?: { enabled?: boolean };
  assets?: { paths?: string[] };
  restic: {
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
}

interface RawYamlConfig {
  projects: RawProjectEntry[];
}

@Injectable()
export class YamlConfigLoaderAdapter implements ConfigLoaderPort {
  private readonly logger = new Logger(YamlConfigLoaderAdapter.name);
  private projects: ProjectConfig[] | null = null;
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
        if (!resolved.restic) {
          errors.push(`Project "${resolved.name}": missing required field: restic`);
        }
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
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to load config: ${message}`);
    }

    return { isValid: errors.length === 0, errors };
  }

  reload(): void {
    this.logger.log('Reloading project configuration');
    this.projects = null;
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

    entry.restic.password ??= this.configService.get<string>('RESTIC_PASSWORD') ?? undefined;

    if (!entry.compression) {
      entry.compression = { enabled: true };
    } else {
      entry.compression.enabled ??= true;
    }
  }

  private buildProjectConfig(raw: RawProjectEntry): ProjectConfig {
    const resolved = this.resolveEnvVarsInObject(
      raw as unknown as Record<string, unknown>,
    ) as unknown as RawProjectEntry;

    this.applyFallbacks(resolved);

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
          }
        : null,
      compression: { enabled: resolved.compression?.enabled ?? true },
      assets: { paths: resolved.assets?.paths ?? [] },
      restic: {
        repositoryPath: resolved.restic.repository_path,
        password: resolved.restic.password ?? '',
        snapshotMode: (resolved.restic.snapshot_mode as 'combined' | 'separate') ?? 'combined',
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
    });
  }
}
