import { Inject } from '@nestjs/common';
import { Command, CommandRunner } from 'nest-commander';
import { ConfigLoaderPort } from '@domain/config/application/ports/config-loader.port';
import { RemoteStorageFactoryPort } from '@domain/backup/application/ports/remote-storage-factory.port';
import { CONFIG_LOADER_PORT, REMOTE_STORAGE_FACTORY } from '@common/di/injection-tokens';

@Command({ name: 'restic', description: 'Execute raw restic command for a project', arguments: '<project> <command> [args...]' })
export class ResticCommand extends CommandRunner {
  constructor(
    @Inject(CONFIG_LOADER_PORT) private readonly configLoader: ConfigLoaderPort,
    @Inject(REMOTE_STORAGE_FACTORY) private readonly storageFactory: RemoteStorageFactoryPort,
  ) { super(); }

  private static readonly DESTRUCTIVE_COMMANDS = ['forget', 'key', 'prune', 'migrate'];

  async run(params: string[]): Promise<void> {
    const [projectName, ...resticArgs] = params;

    if (!projectName || resticArgs.length === 0) { console.error('Usage: backupctl restic <project> <command> [args...]'); process.exitCode = 1; return; }

    const subCommand = resticArgs[0];
    if (ResticCommand.DESTRUCTIVE_COMMANDS.includes(subCommand)) {
      console.error(`Error: "${subCommand}" is a destructive operation. Use the dedicated CLI commands instead (e.g., backupctl prune).`);
      process.exitCode = 1;
      return;
    }

    try {
      const config = this.configLoader.getProject(projectName);
      const storage = this.storageFactory.create(config);
      const output = await storage.exec(resticArgs);
      console.log(output);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      process.exitCode = 1;
    }
  }
}
