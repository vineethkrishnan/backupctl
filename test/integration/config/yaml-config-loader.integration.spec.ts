import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { ConfigService } from '@nestjs/config';
import { YamlConfigLoaderAdapter } from '@domain/config/infrastructure/yaml-config-loader.adapter';
import { ProjectConfig } from '@domain/config/domain/project-config.model';

jest.setTimeout(30000);

function buildTestYaml(overrides: Record<string, unknown> = {}): string {
  const project = {
    name: 'vinsware',
    enabled: true,
    cron: '0 2 * * *',
    timeout_minutes: 30,
    database: {
      type: 'postgres',
      host: 'db.vinsware.test',
      port: 5432,
      name: 'vinsware_prod',
      user: 'vinsware_user',
      password: '${VINSWARE_DB_PASSWORD}',
    },
    assets: { paths: ['/data/vinsware/uploads'] },
    restic: {
      repository_path: 'sftp:storage:/backups/vinsware',
      password: '${RESTIC_PASSWORD}',
      snapshot_mode: 'combined',
    },
    retention: {
      local_days: 7,
      keep_daily: 7,
      keep_weekly: 4,
      keep_monthly: 3,
    },
    verification: { enabled: true },
    ...overrides,
  };

  return yaml.dump({ projects: [project] });
}

function buildMultiProjectYaml(): string {
  const projects = [
    {
      name: 'vinsware',
      cron: '0 2 * * *',
      database: {
        type: 'postgres',
        host: 'db.vinsware.test',
        port: 5432,
        name: 'vinsware_prod',
        user: 'vinsware_user',
        password: 'plain-pass',
      },
      restic: {
        repository_path: 'sftp:storage:/backups/vinsware',
        password: 'restic-pass',
      },
      retention: { local_days: 7, keep_daily: 7, keep_weekly: 4 },
    },
    {
      name: 'shopify-sync',
      cron: '30 3 * * *',
      database: {
        type: 'mysql',
        host: 'db.shopify.test',
        port: 3306,
        name: 'shopify_db',
        user: 'shop_user',
        password: 'shop-pass',
      },
      restic: {
        repository_path: 'sftp:storage:/backups/shopify',
        password: 'restic-pass-2',
      },
      retention: { local_days: 14, keep_daily: 14, keep_weekly: 8 },
    },
  ];

  return yaml.dump({ projects });
}

describe('YamlConfigLoaderAdapter (integration)', () => {
  let tempDir: string;
  let tempConfigPath: string;
  const savedEnv: Record<string, string | undefined> = {};

  function setEnvVar(key: string, value: string): void {
    savedEnv[key] = process.env[key];
    process.env[key] = value;
  }

  function createAdapter(envOverrides: Record<string, string> = {}): YamlConfigLoaderAdapter {
    const configService = {
      get: jest.fn((key: string, defaultValue?: string) => {
        if (key in envOverrides) return envOverrides[key];
        return defaultValue;
      }),
    } as unknown as ConfigService;

    const adapter = new YamlConfigLoaderAdapter(configService);

    // Override the private configPath to point to our temp file
    Object.defineProperty(adapter, 'configPath', { value: tempConfigPath });

    return adapter;
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backupctl-config-test-'));
    tempConfigPath = path.join(tempDir, 'projects.yml');
  });

  afterEach(() => {
    // Restore env vars
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    Object.keys(savedEnv).forEach((key) => delete savedEnv[key]);

    // Clean up temp files
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('loadAll', () => {
    it('should load YAML and create ProjectConfig objects', () => {
      setEnvVar('VINSWARE_DB_PASSWORD', 'test-secret-123');
      setEnvVar('RESTIC_PASSWORD', 'restic-secret');
      fs.writeFileSync(tempConfigPath, buildTestYaml());

      const adapter = createAdapter();
      const result = adapter.loadAll();

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(ProjectConfig);
      expect(result[0].name).toBe('vinsware');
      expect(result[0].database?.type).toBe('postgres');
      expect(result[0].database?.host).toBe('db.vinsware.test');
      expect(result[0].database?.port).toBe(5432);
      expect(result[0].cron).toBe('0 2 * * *');
      expect(result[0].timeoutMinutes).toBe(30);
      expect(result[0].hasTimeout()).toBe(true);
      expect(result[0].hasVerification()).toBe(true);
    });

    it('should resolve ${VAR_NAME} placeholders from environment', () => {
      setEnvVar('VINSWARE_DB_PASSWORD', 'resolved-db-pass');
      setEnvVar('RESTIC_PASSWORD', 'resolved-restic-pass');
      fs.writeFileSync(tempConfigPath, buildTestYaml());

      const adapter = createAdapter();
      const result = adapter.loadAll();

      expect(result[0].database?.password).toBe('resolved-db-pass');
      expect(result[0].restic.password).toBe('resolved-restic-pass');
    });
  });

  describe('env fallbacks', () => {
    it('should fall back to env defaults when notification block is missing', () => {
      setEnvVar('VINSWARE_DB_PASSWORD', 'pass');
      setEnvVar('RESTIC_PASSWORD', 'rpass');
      fs.writeFileSync(tempConfigPath, buildTestYaml());

      const adapter = createAdapter({
        NOTIFICATION_TYPE: 'slack',
        SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/test',
      });
      const result = adapter.loadAll();

      expect(result[0].notification).toEqual({
        type: 'slack',
        config: { webhook_url: 'https://hooks.slack.com/services/test' },
      });
    });

    it('should fall back to env defaults for missing encryption', () => {
      setEnvVar('VINSWARE_DB_PASSWORD', 'pass');
      setEnvVar('RESTIC_PASSWORD', 'rpass');
      fs.writeFileSync(tempConfigPath, buildTestYaml());

      const adapter = createAdapter({
        ENCRYPTION_ENABLED: 'true',
        ENCRYPTION_TYPE: 'gpg',
        GPG_RECIPIENT: 'ops@company.com',
      });
      const result = adapter.loadAll();

      expect(result[0].encryption).toEqual({
        enabled: true,
        type: 'gpg',
        recipient: 'ops@company.com',
      });
      expect(result[0].hasEncryption()).toBe(true);
    });
  });

  describe('validate', () => {
    it('should return isValid:true for valid config', () => {
      setEnvVar('VINSWARE_DB_PASSWORD', 'pass');
      setEnvVar('RESTIC_PASSWORD', 'rpass');
      fs.writeFileSync(tempConfigPath, buildTestYaml());

      const adapter = createAdapter();
      const result = adapter.validate();

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return errors for unresolved env vars', () => {
      delete process.env.VINSWARE_DB_PASSWORD;
      delete process.env.RESTIC_PASSWORD;
      fs.writeFileSync(tempConfigPath, buildTestYaml());

      const adapter = createAdapter();
      const result = adapter.validate();

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('VINSWARE_DB_PASSWORD'))).toBe(true);
    });

    it('should return error when monitor is missing type', () => {
      setEnvVar('VINSWARE_DB_PASSWORD', 'pass');
      setEnvVar('RESTIC_PASSWORD', 'rpass');
      fs.writeFileSync(tempConfigPath, buildTestYaml({
        monitor: { config: { push_token: 'tok-123' } },
      }));

      const adapter = createAdapter();
      const result = adapter.validate();

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('monitor missing required field: type'))).toBe(true);
    });

    it('should return error when uptime-kuma monitor is missing push_token', () => {
      setEnvVar('VINSWARE_DB_PASSWORD', 'pass');
      setEnvVar('RESTIC_PASSWORD', 'rpass');
      fs.writeFileSync(tempConfigPath, buildTestYaml({
        monitor: { type: 'uptime-kuma', config: {} },
      }));

      const adapter = createAdapter({ UPTIME_KUMA_BASE_URL: 'https://kuma.example.com' });
      const result = adapter.validate();

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('requires config.push_token'))).toBe(true);
    });

    it('should return error when uptime-kuma monitor is missing UPTIME_KUMA_BASE_URL', () => {
      setEnvVar('VINSWARE_DB_PASSWORD', 'pass');
      setEnvVar('RESTIC_PASSWORD', 'rpass');
      fs.writeFileSync(tempConfigPath, buildTestYaml({
        monitor: { type: 'uptime-kuma', config: { push_token: 'tok-123' } },
      }));

      const adapter = createAdapter();
      const result = adapter.validate();

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('requires UPTIME_KUMA_BASE_URL'))).toBe(true);
    });

    it('should pass validation for valid uptime-kuma monitor config', () => {
      setEnvVar('VINSWARE_DB_PASSWORD', 'pass');
      setEnvVar('RESTIC_PASSWORD', 'rpass');
      fs.writeFileSync(tempConfigPath, buildTestYaml({
        monitor: { type: 'uptime-kuma', config: { push_token: 'tok-123' } },
      }));

      const adapter = createAdapter({ UPTIME_KUMA_BASE_URL: 'https://kuma.example.com' });
      const result = adapter.validate();

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('getProject', () => {
    it('should return the correct project by name', () => {
      fs.writeFileSync(tempConfigPath, buildMultiProjectYaml());

      const adapter = createAdapter();
      const vinsware = adapter.getProject('vinsware');
      const shopify = adapter.getProject('shopify-sync');

      expect(vinsware.name).toBe('vinsware');
      expect(vinsware.database?.type).toBe('postgres');
      expect(shopify.name).toBe('shopify-sync');
      expect(shopify.database?.type).toBe('mysql');
    });

    it('should throw for unknown project', () => {
      fs.writeFileSync(tempConfigPath, buildMultiProjectYaml());

      const adapter = createAdapter();

      expect(() => adapter.getProject('nonexistent')).toThrow(
        'Project "nonexistent" not found in configuration',
      );
    });
  });

  describe('reload', () => {
    it('should re-read YAML file and reflect changes', () => {
      fs.writeFileSync(tempConfigPath, buildMultiProjectYaml());

      const adapter = createAdapter();
      const initial = adapter.loadAll();
      expect(initial).toHaveLength(2);

      // Overwrite YAML with a single project
      const updatedYaml = yaml.dump({
        projects: [
          {
            name: 'new-project',
            cron: '0 4 * * *',
            database: {
              type: 'mongodb',
              host: 'mongo.test',
              port: 27017,
              name: 'newdb',
              user: 'admin',
              password: 'secret',
            },
            restic: {
              repository_path: '/backups/new',
              password: 'rpass',
            },
            retention: { local_days: 3, keep_daily: 3, keep_weekly: 2 },
          },
        ],
      });
      fs.writeFileSync(tempConfigPath, updatedYaml);

      adapter.reload();

      const reloaded = adapter.loadAll();
      expect(reloaded).toHaveLength(1);
      expect(reloaded[0].name).toBe('new-project');
      expect(reloaded[0].database?.type).toBe('mongodb');
    });
  });
});
