import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { ConfigService } from '@nestjs/config';
import { YamlConfigLoaderAdapter } from '@domain/config/infrastructure/yaml-config-loader.adapter';
import { ProjectConfig } from '@domain/config/domain/project-config.model';

jest.mock('fs');

const mockedFs = fs as jest.Mocked<typeof fs>;

function buildMinimalYaml(overrides: Record<string, unknown> = {}): string {
  const project = {
    name: 'test-project',
    enabled: true,
    cron: '0 0 * * *',
    database: {
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      name: 'testdb',
      user: 'user',
      password: 'secret',
    },
    restic: {
      repository_path: '/backups/test',
      password: 'restic-pass',
      snapshot_mode: 'combined',
    },
    retention: {
      local_days: 7,
      keep_daily: 7,
      keep_weekly: 4,
    },
    ...overrides,
  };

  return yaml.dump({ projects: [project] });
}

function createAdapter(envOverrides: Record<string, string> = {}): YamlConfigLoaderAdapter {
  const configService = {
    get: jest.fn((key: string, defaultValue?: string) => {
      if (key in envOverrides) return envOverrides[key];
      return defaultValue;
    }),
  } as unknown as ConfigService;

  return new YamlConfigLoaderAdapter(configService);
}

describe('YamlConfigLoaderAdapter', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('loadAll', () => {
    it('should load valid YAML and return ProjectConfig array', () => {
      mockedFs.readFileSync.mockReturnValue(buildMinimalYaml());
      const adapter = createAdapter();

      const result = adapter.loadAll();

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(ProjectConfig);
      expect(result[0].name).toBe('test-project');
      expect(result[0].database?.type).toBe('postgres');
      expect(result[0].restic.repositoryPath).toBe('/backups/test');
    });

    it('should resolve ${VAR_NAME} from environment', () => {
      process.env.MY_DB_PASSWORD = 'env-secret-123';
      const yamlContent = buildMinimalYaml({
        database: {
          type: 'postgres',
          host: 'localhost',
          port: 5432,
          name: 'testdb',
          user: 'user',
          password: '${MY_DB_PASSWORD}',
        },
      });
      mockedFs.readFileSync.mockReturnValue(yamlContent);
      const adapter = createAdapter();

      const result = adapter.loadAll();

      expect(result[0].database?.password).toBe('env-secret-123');
    });

    it('should throw when env var is not set for ${VAR_NAME}', () => {
      delete process.env.MISSING_VAR;
      const yamlContent = buildMinimalYaml({
        database: {
          type: 'postgres',
          host: 'localhost',
          port: 5432,
          name: 'testdb',
          user: 'user',
          password: '${MISSING_VAR}',
        },
      });
      mockedFs.readFileSync.mockReturnValue(yamlContent);
      const adapter = createAdapter();

      expect(() => adapter.loadAll()).toThrow('Environment variable "MISSING_VAR" is not set');
    });

    it('should default compression to enabled:true when missing', () => {
      const yamlContent = buildMinimalYaml();
      // Remove compression from YAML by not including it
      const parsed = yaml.load(yamlContent) as { projects: Record<string, unknown>[] };
      delete parsed.projects[0].compression;
      mockedFs.readFileSync.mockReturnValue(yaml.dump(parsed));
      const adapter = createAdapter();

      const result = adapter.loadAll();

      expect(result[0].compression.enabled).toBe(true);
    });

    it('should fall back to env defaults for missing notification', () => {
      mockedFs.readFileSync.mockReturnValue(buildMinimalYaml());
      const adapter = createAdapter({
        NOTIFICATION_TYPE: 'slack',
        SLACK_WEBHOOK_URL: 'https://hooks.slack.com/global',
      });

      const result = adapter.loadAll();

      expect(result[0].notification).toEqual({
        type: 'slack',
        config: { webhook_url: 'https://hooks.slack.com/global' },
      });
    });

    it('should fall back to env defaults for missing encryption', () => {
      mockedFs.readFileSync.mockReturnValue(buildMinimalYaml());
      const adapter = createAdapter({
        ENCRYPTION_ENABLED: 'true',
        ENCRYPTION_TYPE: 'gpg',
        GPG_RECIPIENT: 'admin@company.com',
      });

      const result = adapter.loadAll();

      expect(result[0].encryption).toEqual({
        enabled: true,
        type: 'gpg',
        recipient: 'admin@company.com',
      });
    });

    it('should fall back to env default for missing restic password', () => {
      const yamlContent = buildMinimalYaml({
        restic: {
          repository_path: '/backups/test',
          snapshot_mode: 'combined',
        },
      });
      mockedFs.readFileSync.mockReturnValue(yamlContent);
      const adapter = createAdapter({
        RESTIC_PASSWORD: 'global-restic-pass',
      });

      const result = adapter.loadAll();

      expect(result[0].restic.password).toBe('global-restic-pass');
    });

    it('should load files-only config (no database)', () => {
      const filesOnlyProject = {
        name: 'static-assets',
        cron: '0 3 * * *',
        assets: { paths: ['/data/uploads', '/data/media'] },
        restic: {
          repository_path: '/backups/assets',
          password: 'restic-pass',
          snapshot_mode: 'combined',
        },
        retention: { local_days: 7, keep_daily: 7, keep_weekly: 4 },
      };
      mockedFs.readFileSync.mockReturnValue(yaml.dump({ projects: [filesOnlyProject] }));
      const adapter = createAdapter();

      const result = adapter.loadAll();

      expect(result[0].database).toBeNull();
      expect(result[0].hasDatabase()).toBe(false);
      expect(result[0].hasAssets()).toBe(true);
      expect(result[0].assets.paths).toEqual(['/data/uploads', '/data/media']);
    });

    it('should throw for invalid YAML structure', () => {
      mockedFs.readFileSync.mockReturnValue(yaml.dump({ invalid: 'structure' }));
      const adapter = createAdapter();

      expect(() => adapter.loadAll()).toThrow('"projects" array is required');
    });
  });

  describe('getProject', () => {
    it('should return the correct project by name', () => {
      mockedFs.readFileSync.mockReturnValue(buildMinimalYaml());
      const adapter = createAdapter();

      const result = adapter.getProject('test-project');

      expect(result.name).toBe('test-project');
    });

    it('should throw for unknown project name', () => {
      mockedFs.readFileSync.mockReturnValue(buildMinimalYaml());
      const adapter = createAdapter();

      expect(() => adapter.getProject('nonexistent')).toThrow(
        'Project "nonexistent" not found in configuration',
      );
    });

    it('should auto-load config if not yet loaded', () => {
      mockedFs.readFileSync.mockReturnValue(buildMinimalYaml());
      const adapter = createAdapter();

      const result = adapter.getProject('test-project');

      expect(mockedFs.readFileSync).toHaveBeenCalledTimes(1);
      expect(result.name).toBe('test-project');
    });
  });

  describe('validate', () => {
    it('should return valid for correct config', () => {
      mockedFs.readFileSync.mockReturnValue(buildMinimalYaml());
      const adapter = createAdapter();

      const result = adapter.validate();

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return errors for unresolved env vars', () => {
      delete process.env.UNSET_VAR;
      const yamlContent = buildMinimalYaml({
        database: {
          type: 'postgres',
          host: 'localhost',
          port: 5432,
          name: 'testdb',
          user: 'user',
          password: '${UNSET_VAR}',
        },
      });
      mockedFs.readFileSync.mockReturnValue(yamlContent);
      const adapter = createAdapter();

      const result = adapter.validate();

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('UNSET_VAR'))).toBe(true);
    });

    it('should return errors for invalid cron expression', () => {
      const yamlContent = buildMinimalYaml({ cron: 'not a cron' });
      mockedFs.readFileSync.mockReturnValue(yamlContent);
      const adapter = createAdapter();

      const result = adapter.validate();

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('invalid cron expression'))).toBe(true);
    });

    it('should return error when neither database nor assets is provided', () => {
      const project = {
        name: 'empty-project',
        cron: '0 0 * * *',
        restic: { repository_path: '/backups/test', password: 'pass' },
        retention: { local_days: 7, keep_daily: 7, keep_weekly: 4 },
      };
      mockedFs.readFileSync.mockReturnValue(yaml.dump({ projects: [project] }));
      const adapter = createAdapter();

      const result = adapter.validate();

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('must have at least one of "database" or "assets"'))).toBe(true);
    });

    it('should return error when projects array is missing', () => {
      mockedFs.readFileSync.mockReturnValue(yaml.dump({ other: 'data' }));
      const adapter = createAdapter();

      const result = adapter.validate();

      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('"projects" array is required');
    });
  });

  describe('reload', () => {
    it('should re-read the YAML file', () => {
      mockedFs.readFileSync.mockReturnValue(buildMinimalYaml());
      const adapter = createAdapter();

      adapter.loadAll();
      expect(mockedFs.readFileSync).toHaveBeenCalledTimes(1);

      adapter.reload();
      expect(mockedFs.readFileSync).toHaveBeenCalledTimes(2);
    });

    it('should reflect changes in the YAML file after reload', () => {
      mockedFs.readFileSync.mockReturnValue(buildMinimalYaml());
      const adapter = createAdapter();

      adapter.loadAll();
      expect(adapter.getProject('test-project').cron).toBe('0 0 * * *');

      mockedFs.readFileSync.mockReturnValue(buildMinimalYaml({ cron: '30 2 * * *' }));
      adapter.reload();
      expect(adapter.getProject('test-project').cron).toBe('30 2 * * *');
    });
  });
});
