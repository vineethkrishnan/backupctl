import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

import { UpgradeInfo } from './upgrade-info.model';

const GITHUB_RELEASES_URL =
  'https://api.github.com/repos/vineethkrishnan/backupctl/releases/latest';

const UPGRADE_INFO_FILENAME = '.upgrade-info';
const CHECK_TIMEOUT_MS = 3_000;

@Injectable()
export class UpgradeCheckService {
  private readonly backupBaseDir: string;

  constructor(private readonly configService: ConfigService) {
    this.backupBaseDir = this.configService.get<string>(
      'BACKUP_BASE_DIR',
      '/data/backups',
    );
  }

  // ── Public API ──────────────────────────────────────────

  async checkForUpdate(): Promise<UpgradeInfo> {
    const currentVersion = this.getCurrentVersion();
    const { version: latestVersion, url: releaseUrl } =
      await this.fetchLatestRelease();

    const info: UpgradeInfo = {
      currentVersion,
      latestVersion,
      releaseUrl,
      checkedAt: new Date().toISOString(),
      upgradeAvailable: this.isNewer(latestVersion, currentVersion),
    };

    this.writeCache(info);
    return info;
  }

  getCachedInfo(): UpgradeInfo | null {
    const filePath = this.cacheFilePath();
    if (!fs.existsSync(filePath)) return null;

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as UpgradeInfo;
    } catch {
      return null;
    }
  }

  clearCache(): void {
    const filePath = this.cacheFilePath();
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  async printUpgradeNotice(): Promise<void> {
    if (this.shouldSkipCheck()) return;

    try {
      const info = await this.resolveUpgradeInfo();
      if (info?.upgradeAvailable) {
        this.printNotice(info);
      }
    } catch {
      // Never block CLI exit for an upgrade check failure
    }
  }

  // ── Resolve: read cache or fetch ───────────────────────

  private async resolveUpgradeInfo(): Promise<UpgradeInfo | null> {
    const cached = this.getCachedInfo();
    if (cached) return cached;

    return this.checkForUpdate();
  }

  // ── GitHub API ──────────────────────────────────────────

  private async fetchLatestRelease(): Promise<{
    version: string;
    url: string;
  }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);

    try {
      const response = await fetch(GITHUB_RELEASES_URL, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'backupctl-upgrade-check',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`GitHub API returned ${String(response.status)}`);
      }

      const data = (await response.json()) as {
        tag_name: string;
        html_url: string;
      };

      return {
        version: data.tag_name.replace(/^v/, ''),
        url: data.html_url,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  // ── Version comparison ──────────────────────────────────

  private getCurrentVersion(): string {
    try {
      const pkgPath = path.resolve(__dirname, '..', '..', '..', 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
        version: string;
      };
      return pkg.version;
    } catch {
      return '0.0.0';
    }
  }

  /**
   * Returns true if `latest` is strictly newer than `current`.
   * Simple semver comparison: major.minor.patch
   */
  private isNewer(latest: string, current: string): boolean {
    const parse = (v: string) => v.split('.').map(Number);
    const [lMajor = 0, lMinor = 0, lPatch = 0] = parse(latest);
    const [cMajor = 0, cMinor = 0, cPatch = 0] = parse(current);

    if (lMajor !== cMajor) return lMajor > cMajor;
    if (lMinor !== cMinor) return lMinor > cMinor;
    return lPatch > cPatch;
  }

  // ── Cache file ──────────────────────────────────────────

  private cacheFilePath(): string {
    return path.join(this.backupBaseDir, UPGRADE_INFO_FILENAME);
  }

  private writeCache(info: UpgradeInfo): void {
    try {
      fs.writeFileSync(this.cacheFilePath(), JSON.stringify(info, null, 2));
    } catch {
      // Non-critical — the check still worked, just won't be cached
    }
  }

  // ── Suppression rules ──────────────────────────────────

  private shouldSkipCheck(): boolean {
    if (process.env.NODE_ENV === 'development') return true;
    if (process.env.BACKUPCTL_NO_UPDATE_CHECK === '1') return true;
    if (!process.stderr.isTTY) return true;
    return false;
  }

  // ── Terminal output ─────────────────────────────────────

  private printNotice(info: UpgradeInfo): void {
    const yellow = (text: string) => `\x1b[33m${text}\x1b[0m`;
    const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;

    const versionLine = `Update available: v${info.currentVersion} → v${info.latestVersion}`;
    const commandLine = 'Run on host: backupctl-manage.sh upgrade';
    const innerWidth = Math.max(versionLine.length, commandLine.length) + 4;

    const top = `  ┌${'─'.repeat(innerWidth)}┐`;
    const bottom = `  └${'─'.repeat(innerWidth)}┘`;
    const pad = (text: string) =>
      `  │  ${text}${' '.repeat(innerWidth - text.length - 2)}│`;

    const lines = [
      '',
      dim(top),
      yellow(pad(versionLine)),
      dim(pad(commandLine)),
      dim(bottom),
      '',
    ];

    process.stderr.write(lines.join('\n'));
  }
}
