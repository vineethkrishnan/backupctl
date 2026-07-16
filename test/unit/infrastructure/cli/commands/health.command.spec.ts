import { HealthCommand } from '@domain/health/presenters/cli/health.command';
import { CheckHealthUseCase } from '@domain/health/application/use-cases/check-health/check-health.use-case';
import { buildHealthCheckResult, buildStorageHealthCheck } from '@test/support/health-check-result.builder';

describe('HealthCommand', () => {
  let command: HealthCommand;
  let checkHealth: jest.Mocked<CheckHealthUseCase>;

  beforeEach(() => {
    checkHealth = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<CheckHealthUseCase>;

    command = new HealthCommand(checkHealth);
    process.exitCode = undefined;
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('should print healthy status when all checks pass', async () => {
    checkHealth.execute.mockResolvedValue(
      buildHealthCheckResult(),
    );

    await command.run([]);

    expect(console.log).toHaveBeenCalledWith('System healthy');
    expect(process.exitCode).toBeUndefined();
  });

  it('should set exit code 1 when unhealthy', async () => {
    checkHealth.execute.mockResolvedValue(
      buildHealthCheckResult({ auditDbConnected: false }),
    );

    await command.run([]);

    expect(console.log).toHaveBeenCalledWith('System unhealthy');
    expect(process.exitCode).toBe(1);
  });

  it('should display individual check results', async () => {
    checkHealth.execute.mockResolvedValue(
      buildHealthCheckResult({ diskFreeGb: 42, uptime: 7200 }),
    );

    await command.run([]);

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Audit DB'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('42 GB free'));
  });

  it('should print a line per project with its backend type', async () => {
    checkHealth.execute.mockResolvedValue(
      buildHealthCheckResult({
        storageChecks: [
          buildStorageHealthCheck({ project: 'vinelab', backendType: 's3' }),
          buildStorageHealthCheck({ project: 'project-x', backendType: 'rclone' }),
        ],
      }),
    );

    await command.run([]);

    const printed = (console.log as jest.Mock).mock.calls.map((call) => String(call[0])).join('\n');
    expect(printed).toContain('Storage: vinelab (s3)');
    expect(printed).toContain('Storage: project-x (rclone)');
  });

  it('should show the backend error and exit 1 when a repo is unreachable', async () => {
    checkHealth.execute.mockResolvedValue(
      buildHealthCheckResult({
        storageChecks: [
          buildStorageHealthCheck({
            project: 'vinelab',
            backendType: 's3',
            reachable: false,
            error: 'Fatal: unable to open config file',
          }),
        ],
      }),
    );

    await command.run([]);

    const printed = (console.log as jest.Mock).mock.calls.map((call) => String(call[0])).join('\n');
    expect(printed).toContain('Fatal: unable to open config file');
    expect(console.log).toHaveBeenCalledWith('System unhealthy');
    expect(process.exitCode).toBe(1);
  });

  it('should print Uptime Kuma line when configured', async () => {
    checkHealth.execute.mockResolvedValue(
      buildHealthCheckResult({ uptimeKumaConfigured: true, uptimeKumaConnected: true }),
    );

    await command.run([]);

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Uptime Kuma'));
  });

  it('should not print Uptime Kuma when not configured', async () => {
    checkHealth.execute.mockResolvedValue(
      buildHealthCheckResult(),
    );

    await command.run([]);

    const printed = (console.log as jest.Mock).mock.calls.map((call) => String(call[0])).join('\n');
    expect(printed).not.toContain('Uptime Kuma');
  });

  it('should set exit code 1 on error', async () => {
    checkHealth.execute.mockRejectedValue(new Error('Health check failed'));

    await command.run([]);

    expect(process.exitCode).toBe(1);
  });
});
