import { Inject } from '@nestjs/common';
import { Command, CommandRunner, SubCommand } from 'nest-commander';
import { ConfigLoaderPort } from '@domain/config/application/ports/config-loader.port';
import { GpgKeyManagerPort } from '@domain/backup/application/ports/gpg-key-manager.port';
import { CONFIG_LOADER_PORT, GPG_KEY_MANAGER_PORT } from '@common/di/injection-tokens';

@SubCommand({ name: 'validate', description: 'Validate project configuration' })
export class ConfigValidateSubCommand extends CommandRunner {
  constructor(@Inject(CONFIG_LOADER_PORT) private readonly configLoader: ConfigLoaderPort) { super(); }

  run(_params: string[]): Promise<void> {
    const result = this.configLoader.validate();
    if (result.isValid) { console.log('Configuration is valid.'); return Promise.resolve(); }
    console.error('Configuration errors:');
    for (const error of result.errors) { console.error(`  - ${error}`); }
    process.exitCode = 3;
    return Promise.resolve();
  }
}

@SubCommand({ name: 'show', description: 'Show project configuration (secrets masked)', arguments: '<project>' })
export class ConfigShowSubCommand extends CommandRunner {
  constructor(@Inject(CONFIG_LOADER_PORT) private readonly configLoader: ConfigLoaderPort) { super(); }

  run(params: string[]): Promise<void> {
    const projectName = params[0];
    try {
      const config = this.configLoader.getProject(projectName);
      const masked = {
        name: config.name, enabled: config.enabled, cron: config.cron, timeoutMinutes: config.timeoutMinutes,
        database: config.database ? { type: config.database.type, host: config.database.host, port: config.database.port, name: config.database.name, user: config.database.user, password: '********' } : null,
        compression: config.compression, assets: config.assets,
        restic: { repositoryPath: config.restic.repositoryPath, password: '********', snapshotMode: config.restic.snapshotMode },
        retention: config.retention, encryption: config.encryption, hooks: config.hooks, verification: config.verification, notification: config.notification,
      };
      console.log(JSON.stringify(masked, null, 2));
    } catch (error) { const message = error instanceof Error ? error.message : String(error); console.error(`Error: ${message}`); process.exitCode = 1; }
    return Promise.resolve();
  }
}

@SubCommand({ name: 'reload', description: 'Reload configuration from disk' })
export class ConfigReloadSubCommand extends CommandRunner {
  constructor(@Inject(CONFIG_LOADER_PORT) private readonly configLoader: ConfigLoaderPort) { super(); }

  run(_params: string[]): Promise<void> {
    try { this.configLoader.reload(); console.log('Configuration reloaded successfully.'); }
    catch (error) { const message = error instanceof Error ? error.message : String(error); console.error(`Error: ${message}`); process.exitCode = 1; }
    return Promise.resolve();
  }
}

@SubCommand({ name: 'import-gpg-key', description: 'Import a GPG key from file', arguments: '<file>' })
export class ConfigImportGpgKeySubCommand extends CommandRunner {
  constructor(@Inject(GPG_KEY_MANAGER_PORT) private readonly gpgKeyManager: GpgKeyManagerPort) { super(); }

  async run(params: string[]): Promise<void> {
    const filePath = params[0];
    try { await this.gpgKeyManager.importKey(filePath); console.log(`GPG key imported from ${filePath}.`); }
    catch (error) { const message = error instanceof Error ? error.message : String(error); console.error(`Error: ${message}`); process.exitCode = 1; }
  }
}

@Command({ name: 'config', description: 'Configuration management', subCommands: [ConfigValidateSubCommand, ConfigShowSubCommand, ConfigReloadSubCommand, ConfigImportGpgKeySubCommand] })
export class ConfigCommand extends CommandRunner {
  run(_params: string[]): Promise<void> {
    console.log('Usage: backupctl config <validate|show|reload|import-gpg-key>');
    return Promise.resolve();
  }
}
