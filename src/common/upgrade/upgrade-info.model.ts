export interface UpgradeInfo {
  readonly currentVersion: string;
  readonly latestVersion: string;
  readonly releaseUrl: string;
  readonly checkedAt: string;
  readonly upgradeAvailable: boolean;
}
