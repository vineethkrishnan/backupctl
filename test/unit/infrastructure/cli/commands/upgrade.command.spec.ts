import { UpgradeCommand } from '@domain/backup/presenters/cli/upgrade.command';
import { UpgradeCheckService } from '@common/upgrade/upgrade-check.service';
import { UpgradeInfo } from '@common/upgrade/upgrade-info.model';

describe('UpgradeCommand', () => {
  let command: UpgradeCommand;
  let upgradeCheckService: jest.Mocked<UpgradeCheckService>;

  const upgradeAvailableInfo: UpgradeInfo = {
    currentVersion: '0.1.8',
    latestVersion: '0.2.0',
    releaseUrl: 'https://github.com/vineethkrishnan/backupctl/releases/tag/v0.2.0',
    checkedAt: '2026-03-22T10:00:00.000Z',
    upgradeAvailable: true,
  };

  const upToDateInfo: UpgradeInfo = {
    currentVersion: '0.1.8',
    latestVersion: '0.1.8',
    releaseUrl: 'https://github.com/vineethkrishnan/backupctl/releases/tag/v0.1.8',
    checkedAt: '2026-03-22T10:00:00.000Z',
    upgradeAvailable: false,
  };

  beforeEach(() => {
    upgradeCheckService = {
      checkForUpdate: jest.fn(),
      clearCache: jest.fn(),
      getCachedInfo: jest.fn(),
      printUpgradeNotice: jest.fn(),
    } as unknown as jest.Mocked<UpgradeCheckService>;

    command = new UpgradeCommand(upgradeCheckService);
    process.exitCode = undefined;
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('should clear cache and force-check for updates', async () => {
    upgradeCheckService.checkForUpdate.mockResolvedValue(upToDateInfo);

    await command.run();

    expect(upgradeCheckService.clearCache).toHaveBeenCalled();
    expect(upgradeCheckService.checkForUpdate).toHaveBeenCalled();
  });

  it('should display current and latest version', async () => {
    upgradeCheckService.checkForUpdate.mockResolvedValue(upToDateInfo);

    await command.run();

    expect(console.log).toHaveBeenCalledWith('Current version:  v0.1.8');
    expect(console.log).toHaveBeenCalledWith('Latest version:   v0.1.8');
  });

  it('should print upgrade instructions when update is available', async () => {
    upgradeCheckService.checkForUpdate.mockResolvedValue(upgradeAvailableInfo);

    await command.run();

    expect(console.log).toHaveBeenCalledWith('A new version is available!');
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('backupctl-manage.sh upgrade'),
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining(upgradeAvailableInfo.releaseUrl),
    );
  });

  it('should print up-to-date message when no update available', async () => {
    upgradeCheckService.checkForUpdate.mockResolvedValue(upToDateInfo);

    await command.run();

    expect(console.log).toHaveBeenCalledWith('You are on the latest version.');
  });

  it('should set exit code 4 on error', async () => {
    upgradeCheckService.checkForUpdate.mockRejectedValue(
      new Error('Network timeout'),
    );

    await command.run();

    expect(console.error).toHaveBeenCalledWith(
      'Failed to check for updates: Network timeout',
    );
    expect(process.exitCode).toBe(4);
  });

  it('should handle non-Error thrown values', async () => {
    upgradeCheckService.checkForUpdate.mockRejectedValue('string error');

    await command.run();

    expect(console.error).toHaveBeenCalledWith(
      'Failed to check for updates: string error',
    );
    expect(process.exitCode).toBe(4);
  });
});
