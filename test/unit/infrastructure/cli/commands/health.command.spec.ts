import { HealthCommand } from '@infrastructure/cli/commands/health.command';
import { HealthCheckService } from '@application/health/health-check.service';
import { HealthCheckResult } from '@domain/audit/models/health-check-result.model';

describe('HealthCommand', () => {
  let command: HealthCommand;
  let healthCheck: jest.Mocked<HealthCheckService>;

  beforeEach(() => {
    healthCheck = {
      checkHealth: jest.fn(),
    } as unknown as jest.Mocked<HealthCheckService>;

    command = new HealthCommand(healthCheck);
    process.exitCode = undefined;
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('should print healthy status when all checks pass', async () => {
    healthCheck.checkHealth.mockResolvedValue(
      new HealthCheckResult(true, true, 50, true, true, true, 3600),
    );

    await command.run([]);

    expect(console.log).toHaveBeenCalledWith('System healthy');
    expect(process.exitCode).toBeUndefined();
  });

  it('should set exit code 1 when unhealthy', async () => {
    healthCheck.checkHealth.mockResolvedValue(
      new HealthCheckResult(false, true, 50, true, true, true, 3600),
    );

    await command.run([]);

    expect(console.log).toHaveBeenCalledWith('System unhealthy');
    expect(process.exitCode).toBe(1);
  });

  it('should display individual check results', async () => {
    healthCheck.checkHealth.mockResolvedValue(
      new HealthCheckResult(true, true, 42, true, true, true, 7200),
    );

    await command.run([]);

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Audit DB'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('42 GB free'));
  });

  it('should set exit code 1 on error', async () => {
    healthCheck.checkHealth.mockRejectedValue(new Error('Health check failed'));

    await command.run([]);

    expect(process.exitCode).toBe(1);
  });
});
