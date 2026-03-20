import { GetRestoreGuideUseCase } from '@domain/backup/application/use-cases/get-restore-guide/get-restore-guide.use-case';
import { GetRestoreGuideQuery } from '@domain/backup/application/use-cases/get-restore-guide/get-restore-guide.query';
import { ConfigLoaderPort } from '@domain/config/application/ports/config-loader.port';
import { ProjectConfig, ProjectConfigParams } from '@domain/config/domain/project-config.model';
import { RetentionPolicy } from '@domain/config/domain/retention-policy.model';

function buildConfig(overrides: Partial<ProjectConfigParams> = {}): ProjectConfig {
  return new ProjectConfig({
    name: 'test-project',
    enabled: true,
    cron: '0 2 * * *',
    timeoutMinutes: null,
    database: { type: 'postgres', host: 'db.example.com', port: 5432, name: 'mydb', user: 'admin', password: 'secret' },
    compression: { enabled: true },
    assets: { paths: [] },
    restic: { repositoryPath: '/repo', password: 'pass', snapshotMode: 'combined' },
    retention: new RetentionPolicy(7, 7, 4, 3),
    encryption: null,
    hooks: null,
    verification: { enabled: false },
    notification: null,
    ...overrides,
  });
}

describe('GetRestoreGuideUseCase', () => {
  let useCase: GetRestoreGuideUseCase;
  let configLoader: jest.Mocked<ConfigLoaderPort>;

  beforeEach(() => {
    configLoader = {
      loadAll: jest.fn(),
      getProject: jest.fn(),
      validate: jest.fn(),
      reload: jest.fn(),
    };
    useCase = new GetRestoreGuideUseCase(configLoader);
  });

  describe('postgres guide', () => {
    it('includes project name, database type, and database name in header', () => {
      configLoader.getProject.mockReturnValue(buildConfig());

      const guide = useCase.execute(new GetRestoreGuideQuery({ projectName: 'test-project' }));

      expect(guide).toContain('test-project');
      expect(guide).toContain('postgres');
      expect(guide).toContain('mydb');
    });

    it('includes restic restore and snapshot lookup steps', () => {
      configLoader.getProject.mockReturnValue(buildConfig());

      const guide = useCase.execute(new GetRestoreGuideQuery({ projectName: 'test-project' }));

      expect(guide).toContain('backupctl restore test-project <SNAPSHOT_ID> <OUTPUT_PATH>');
      expect(guide).toContain('backupctl snapshots test-project');
    });

    it('includes pg_restore command with database name', () => {
      configLoader.getProject.mockReturnValue(buildConfig());

      const guide = useCase.execute(new GetRestoreGuideQuery({ projectName: 'test-project' }));

      expect(guide).toContain('pg_restore');
      expect(guide).toContain('mydb');
    });

    it('uses placeholders instead of real credentials', () => {
      configLoader.getProject.mockReturnValue(buildConfig());

      const guide = useCase.execute(new GetRestoreGuideQuery({ projectName: 'test-project' }));

      expect(guide).toContain('<HOST>');
      expect(guide).toContain('<PORT>');
      expect(guide).toContain('<USER>');
      expect(guide).not.toContain('db.example.com');
      expect(guide).not.toContain('admin');
    });

    it('references projects.yml for connection details', () => {
      configLoader.getProject.mockReturnValue(buildConfig());

      const guide = useCase.execute(new GetRestoreGuideQuery({ projectName: 'test-project' }));

      expect(guide).toContain('projects.yml');
    });
  });

  describe('without encryption', () => {
    it('omits GPG decrypt step when encryption is not configured', () => {
      configLoader.getProject.mockReturnValue(buildConfig({ encryption: null }));

      const guide = useCase.execute(new GetRestoreGuideQuery({ projectName: 'test-project' }));

      expect(guide).not.toContain('gpg --decrypt');
      expect(guide).not.toContain('private key');
    });

    it('goes directly from restic restore to database restore', () => {
      configLoader.getProject.mockReturnValue(buildConfig({ encryption: null }));

      const guide = useCase.execute(new GetRestoreGuideQuery({ projectName: 'test-project' }));

      expect(guide).toContain('Step 1: Restore snapshot from Restic');
      expect(guide).toContain('Step 2: Restore to database');
      expect(guide).not.toContain('Step 3');
    });
  });

  describe('with encryption', () => {
    const encryptedConfig = {
      encryption: { enabled: true, type: 'gpg', recipient: 'vineeth@example.com' },
    };

    it('includes GPG decrypt step between restic restore and database restore', () => {
      configLoader.getProject.mockReturnValue(buildConfig(encryptedConfig));

      const guide = useCase.execute(new GetRestoreGuideQuery({ projectName: 'test-project' }));

      expect(guide).toContain('Step 1: Restore snapshot from Restic');
      expect(guide).toContain('Step 2: Decrypt the dump (GPG-encrypted)');
      expect(guide).toContain('Step 3: Restore to database');
    });

    it('includes GPG decrypt command and recipient', () => {
      configLoader.getProject.mockReturnValue(buildConfig(encryptedConfig));

      const guide = useCase.execute(new GetRestoreGuideQuery({ projectName: 'test-project' }));

      expect(guide).toContain('gpg --decrypt');
      expect(guide).toContain('Recipient: vineeth@example.com');
    });

    it('warns about private key requirement', () => {
      configLoader.getProject.mockReturnValue(buildConfig(encryptedConfig));

      const guide = useCase.execute(new GetRestoreGuideQuery({ projectName: 'test-project' }));

      expect(guide).toContain('private key must be available');
    });

    it('warns not to store private key on backup server', () => {
      configLoader.getProject.mockReturnValue(buildConfig(encryptedConfig));

      const guide = useCase.execute(new GetRestoreGuideQuery({ projectName: 'test-project' }));

      expect(guide).toContain('Never store the GPG private key on the backup server');
    });
  });

  describe('mysql guide', () => {
    it('returns mysql restore command', () => {
      configLoader.getProject.mockReturnValue(buildConfig({ database: { type: 'mysql', host: 'db', port: 3306, name: 'app', user: 'root', password: 'secret' } }));

      const guide = useCase.execute(new GetRestoreGuideQuery({ projectName: 'test-project' }));

      expect(guide).toContain('mysql');
      expect(guide).toContain('mysql -h');
    });
  });

  describe('mongodb guide', () => {
    it('returns mongorestore command', () => {
      configLoader.getProject.mockReturnValue(buildConfig({ database: { type: 'mongodb', host: 'db', port: 27017, name: 'app', user: 'root', password: 'secret' } }));

      const guide = useCase.execute(new GetRestoreGuideQuery({ projectName: 'test-project' }));

      expect(guide).toContain('mongodb');
      expect(guide).toContain('mongorestore');
    });
  });

  describe('edge cases', () => {
    it('returns fallback message for unsupported database type', () => {
      configLoader.getProject.mockReturnValue(buildConfig({ database: { type: 'redis', host: 'db', port: 6379, name: 'cache', user: 'u', password: 'p' } }));

      const guide = useCase.execute(new GetRestoreGuideQuery({ projectName: 'test-project' }));

      expect(guide).toContain('No restore guide available for database type: redis');
    });

    it('is case-insensitive on database type', () => {
      configLoader.getProject.mockReturnValue(buildConfig({ database: { type: 'POSTGRES', host: 'db', port: 5432, name: 'mydb', user: 'u', password: 'p' } }));

      const guide = useCase.execute(new GetRestoreGuideQuery({ projectName: 'test-project' }));

      expect(guide).toContain('pg_restore');
    });

    it('throws when project not found', () => {
      configLoader.getProject.mockImplementation(() => { throw new Error('Project "unknown" not found'); });

      expect(() => useCase.execute(new GetRestoreGuideQuery({ projectName: 'unknown' }))).toThrow('not found');
    });

    it('returns no-database message for files-only projects', () => {
      configLoader.getProject.mockReturnValue(buildConfig({ database: null }));

      const guide = useCase.execute(new GetRestoreGuideQuery({ projectName: 'test-project' }));

      expect(guide).toContain('no database configured');
    });
  });
});
