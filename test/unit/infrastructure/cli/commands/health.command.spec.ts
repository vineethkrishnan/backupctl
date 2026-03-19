import { HealthCommand } from '@domain/health/presenters/cli/health.command';
import { CheckHealthUseCase } from '@domain/health/application/use-cases/check-health/check-health.use-case';
import { HealthCheckResult } from '@domain/audit/domain/health-check-result.model';

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
      new HealthCheckResult(true, true, 50, true, true, true, 3600),
    );

    await command.run([]);

    expect(console.log).toHaveBeenCalledWith('System healthy');
    expect(process.exitCode).toBeUndefined();
  });

  it('should set exit code 1 when unhealthy', async () => {
    checkHealth.execute.mockResolvedValue(
      new HealthCheckResult(false, true, 50, true, true, true, 3600),
    );

    await command.run([]);

    expect(console.log).toHaveBeenCalledWith('System unhealthy');
    expect(process.exitCode).toBe(1);
  });

  it('should display individual check results', async () => {
    checkHealth.execute.mockResolvedValue(
      new HealthCheckResult(true, true, 42, true, true, true, 7200),
    );

    await command.run([]);

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Audit DB'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('42 GB free'));
  });

  it('should set exit code 1 on error', async () => {
    checkHealth.execute.mockRejectedValue(new Error('Health check failed'));

    await command.run([]);

    expect(process.exitCode).toBe(1);
  });
});
