import { GetRestoreGuideUseCase } from '@domain/backup/application/use-cases/get-restore-guide/get-restore-guide.use-case';
import { GetRestoreGuideQuery } from '@domain/backup/application/use-cases/get-restore-guide/get-restore-guide.query';
import { ConfigLoaderPort } from '@domain/config/application/ports/config-loader.port';
import { ProjectConfig } from '@domain/config/domain/project-config.model';
import { RetentionPolicy } from '@domain/config/domain/retention-policy.model';

function buildConfig(dbType: string): ProjectConfig {
  return new ProjectConfig({
    name: 'test-project',
    enabled: true,
    cron: '0 2 * * *',
    timeoutMinutes: null,
    database: { type: dbType, host: 'db.example.com', port: 5432, name: 'mydb', user: 'admin', password: 'secret' },
    compression: { enabled: true },
    assets: { paths: [] },
    restic: { repositoryPath: '/repo', password: 'pass', snapshotMode: 'combined' },
    retention: new RetentionPolicy(7, 7, 4, 3),
    encryption: null,
    hooks: null,
    verification: { enabled: false },
    notification: null,
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

  it('returns postgres restore guide with placeholders instead of credentials', () => {
    configLoader.getProject.mockReturnValue(buildConfig('postgres'));

    const guide = useCase.execute(new GetRestoreGuideQuery({ projectName: 'test-project' }));

    expect(guide).toContain('PostgreSQL');
    expect(guide).toContain('pg_restore');
    expect(guide).toContain('<HOST>');
    expect(guide).toContain('<PORT>');
    expect(guide).toContain('<USER>');
    expect(guide).toContain('mydb');
    expect(guide).not.toContain('db.example.com');
    expect(guide).not.toContain('admin');
    expect(guide).toContain('projects.yml');
  });

  it('returns mysql restore guide', () => {
    configLoader.getProject.mockReturnValue(buildConfig('mysql'));

    const guide = useCase.execute(new GetRestoreGuideQuery({ projectName: 'test-project' }));

    expect(guide).toContain('MySQL');
    expect(guide).toContain('mysql -h');
  });

  it('returns mongodb restore guide', () => {
    configLoader.getProject.mockReturnValue(buildConfig('mongodb'));

    const guide = useCase.execute(new GetRestoreGuideQuery({ projectName: 'test-project' }));

    expect(guide).toContain('MongoDB');
    expect(guide).toContain('mongorestore');
  });

  it('returns fallback message for unsupported database type', () => {
    configLoader.getProject.mockReturnValue(buildConfig('redis'));

    const guide = useCase.execute(new GetRestoreGuideQuery({ projectName: 'test-project' }));

    expect(guide).toContain('No restore guide available for database type: redis');
  });

  it('is case-insensitive on database type', () => {
    configLoader.getProject.mockReturnValue(buildConfig('POSTGRES'));

    const guide = useCase.execute(new GetRestoreGuideQuery({ projectName: 'test-project' }));

    expect(guide).toContain('pg_restore');
  });

  it('throws when project not found', () => {
    configLoader.getProject.mockImplementation(() => { throw new Error('Project "unknown" not found'); });

    expect(() => useCase.execute(new GetRestoreGuideQuery({ projectName: 'unknown' }))).toThrow('not found');
  });

  it('returns no-database message for files-only projects', () => {
    const filesOnlyConfig = new ProjectConfig({
      name: 'static-assets',
      enabled: true,
      cron: '0 3 * * *',
      timeoutMinutes: null,
      database: null,
      compression: { enabled: true },
      assets: { paths: ['/data/uploads'] },
      restic: { repositoryPath: '/repo', password: 'pass', snapshotMode: 'combined' },
      retention: new RetentionPolicy(7, 7, 4, 3),
      encryption: null,
      hooks: null,
      verification: { enabled: false },
      notification: null,
    });
    configLoader.getProject.mockReturnValue(filesOnlyConfig);

    const guide = useCase.execute(new GetRestoreGuideQuery({ projectName: 'static-assets' }));

    expect(guide).toContain('no database configured');
  });

  it('includes encryption guidance in each guide', () => {
    configLoader.getProject.mockReturnValue(buildConfig('postgres'));

    const guide = useCase.execute(new GetRestoreGuideQuery({ projectName: 'test-project' }));

    expect(guide).toContain('gpg --decrypt');
  });
});
