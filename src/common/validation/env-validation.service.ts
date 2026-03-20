import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface EnvRule {
  readonly key: string;
  readonly requiredInProduction: boolean;
  readonly description: string;
}

const REQUIRED_ENV_VARS: EnvRule[] = [
  { key: 'AUDIT_DB_HOST', requiredInProduction: true, description: 'Audit database host' },
  { key: 'AUDIT_DB_PASSWORD', requiredInProduction: true, description: 'Audit database password' },
  { key: 'HETZNER_SSH_HOST', requiredInProduction: true, description: 'Hetzner Storage Box SSH host' },
  { key: 'HETZNER_SSH_USER', requiredInProduction: true, description: 'Hetzner SSH user' },
  { key: 'HETZNER_SSH_KEY_PATH', requiredInProduction: true, description: 'Path to SSH private key' },
  { key: 'RESTIC_PASSWORD', requiredInProduction: false, description: 'Global restic password (can be per-project)' },
];

@Injectable()
export class EnvValidationService implements OnModuleInit {
  private readonly logger = new Logger(EnvValidationService.name);

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const isProduction = this.configService.get('NODE_ENV') === 'production';
    const isCliMode = this.configService.get('BACKUPCTL_CLI_MODE') === '1';

    if (isCliMode) return;

    const missing: string[] = [];
    const warnings: string[] = [];

    for (const rule of REQUIRED_ENV_VARS) {
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
}
