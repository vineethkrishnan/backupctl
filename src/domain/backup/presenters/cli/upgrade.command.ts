import { Command, CommandRunner } from 'nest-commander';
import { UpgradeCheckService } from '@common/upgrade/upgrade-check.service';

@Command({
  name: 'upgrade',
  description: 'Check for updates and show upgrade instructions',
})
export class UpgradeCommand extends CommandRunner {
  constructor(private readonly upgradeCheckService: UpgradeCheckService) {
    super();
  }

  async run(): Promise<void> {
    try {
      // Force-refresh: always check GitHub, ignore cache
      this.upgradeCheckService.clearCache();
      const info = await this.upgradeCheckService.checkForUpdate();

      console.log(`Current version:  v${info.currentVersion}`);
      console.log(`Latest version:   v${info.latestVersion}`);

      if (info.upgradeAvailable) {
        console.log('');
        console.log(`A new version is available!`);
        console.log(`Release: ${info.releaseUrl}`);
        console.log('');
        console.log('To upgrade, run on the host machine:');
        console.log('');
        console.log('  backupctl-manage.sh upgrade');
        console.log('');
      } else {
        console.log('');
        console.log('You are on the latest version.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to check for updates: ${message}`);
      process.exitCode = 4;
    }
  }
}
