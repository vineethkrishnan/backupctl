import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ConfigLoaderPort } from '@domain/config/application/ports/config-loader.port';
import { CONFIG_LOADER_PORT } from '@common/di/injection-tokens';

interface EnvRule {
  readonly key: string;
  readonly requiredInProduction: boolean;
  readonly description: string;
}

const REQUIRED_ENV_VARS: EnvRule[] = [
  { key: 'AUDIT_DB_HOST', requiredInProduction: true, description: 'Audit database host' },
  { key: 'AUDIT_DB_PASSWORD', requiredInProduction: true, description: 'Audit database password' },
  { key: 'RESTIC_PASSWORD', requiredInProduction: false, description: 'Global restic password (can be per-project)' },
];

const SFTP_ENV_VARS: EnvRule[] = [
  { key: 'HETZNER_SSH_HOST', requiredInProduction: true, description: 'Hetzner Storage Box SSH host' },
  { key: 'HETZNER_SSH_USER', requiredInProduction: true, description: 'Hetzner SSH user' },
  { key: 'HETZNER_SSH_KEY_PATH', requiredInProduction: true, description: 'Path to SSH private key' },
];

@Injectable()
export class EnvValidationService implements OnModuleInit {
  private readonly logger = new Logger(EnvValidationService.name);

  constructor(
    private readonly configService: ConfigService,
    @Inject(CONFIG_LOADER_PORT) private readonly configLoader: ConfigLoaderPort,
  ) {}

  onModuleInit(): void {
    const isProduction = this.configService.get('NODE_ENV') === 'production';
    const isCliMode = this.configService.get('BACKUPCTL_CLI_MODE') === '1';

    if (isCliMode) return;

    const rules = [...REQUIRED_ENV_VARS, ...(this.hasSftpProject() ? SFTP_ENV_VARS : [])];

    const missing: string[] = [];
    const warnings: string[] = [];

    for (const rule of rules) {
      const value = this.configService.get<string>(rule.key);

      if (!value && rule.requiredInProduction && isProduction) {
        missing.push(`  ${rule.key} — ${rule.description}`);
      } else if (!value && rule.requiredInProduction) {
        warnings.push(`  ${rule.key} — ${rule.description}`);
      }
    }

    if (missing.length > 0) {
      const message =
        `Missing required environment variables for production:\n${missing.join('\n')}\n` +
        'Set them in .env or the container environment.';
      throw new Error(message);
    }

    if (warnings.length > 0) {
      this.logger.warn(
        `Missing recommended env vars (will be required in production):\n${warnings.join('\n')}`,
      );
    }
  }

  /**
   * A broken projects.yml is `config validate`'s problem, not boot's — an unreadable
   * config must not turn into a misleading "missing env var" failure.
   */
  private hasSftpProject(): boolean {
    try {
      return this.configLoader
        .loadAll()
        .some((project) => project.enabled && project.storage.type === 'sftp');
    } catch (error) {
      this.logger.warn(
        `Could not read project config to determine storage backends; skipping backend-specific env checks: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }
}
