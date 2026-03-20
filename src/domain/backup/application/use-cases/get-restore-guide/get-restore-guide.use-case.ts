import { Inject, Injectable } from '@nestjs/common';
import { ConfigLoaderPort } from '@domain/config/application/ports/config-loader.port';
import { ProjectConfig } from '@domain/config/domain/project-config.model';
import { CONFIG_LOADER_PORT } from '@common/di/injection-tokens';
import { GetRestoreGuideQuery } from './get-restore-guide.query';

@Injectable()
export class GetRestoreGuideUseCase {
  constructor(
    @Inject(CONFIG_LOADER_PORT) private readonly configLoader: ConfigLoaderPort,
  ) {}

  execute(query: GetRestoreGuideQuery): string {
    const config = this.configLoader.getProject(query.projectName);

    if (!config.hasDatabase()) {
      return 'This project has no database configured — restore guide is only available for database backups.';
    }

    const db = config.database;
    if (!db) {
      return 'This project has no database configured — restore guide is only available for database backups.';
    }

    const dbType = db.type.toLowerCase();
    const restoreCommand = this.getRestoreCommand(dbType, db.name);
    if (!restoreCommand) {
      return `No restore guide available for database type: ${dbType}`;
    }

    return this.buildGuide(config, dbType, db.name, restoreCommand);
  }

  private buildGuide(config: ProjectConfig, dbType: string, dbName: string, restoreCommand: string): string {
    const lines: string[] = [];
    const isEncrypted = config.hasEncryption();
    const recipient = config.encryption?.recipient;
    const dumpFileExt = this.getDumpFileExtension(dbType);
    let step = 1;

    // Header
    lines.push(`Restore Guide for ${config.name} (${dbType} — ${dbName})`);
    lines.push('═'.repeat(60));
    lines.push('');

    // Step 1: Restore from Restic
    lines.push(`Step ${step}: Restore snapshot from Restic`);
    lines.push(`  backupctl restore ${config.name} <SNAPSHOT_ID> <OUTPUT_PATH>`);
    lines.push('');
    lines.push('  To find available snapshots:');
    lines.push(`  backupctl snapshots ${config.name}`);
    step++;

    // Decrypt before decompress — encryption wraps the compressed dump file
    if (isEncrypted) {
      lines.push('');
      lines.push(`Step ${step}: Decrypt the dump (GPG-encrypted)`);
      lines.push(`  gpg --decrypt <file>${dumpFileExt}.gpg > <file>${dumpFileExt}`);
      if (recipient) {
        lines.push(`  Recipient: ${recipient}`);
      }
      lines.push('  ⚠ The private key must be available in your GPG keyring');
      step++;
    }

    // Decompress after decrypt — MySQL dumps are gzipped .sql.gz
    if (dbType === 'mysql') {
      lines.push('');
      lines.push(`Step ${step}: Decompress the dump`);
      lines.push('  gunzip <file>.sql.gz');
      step++;
    }

    // Step: Restore to database
    lines.push('');
    lines.push(`Step ${step}: Restore to database`);
    lines.push(`  ${restoreCommand}`);
    step++;

    // Footer
    lines.push('');
    lines.push('─'.repeat(60));
    lines.push('Tip: Connection details are in your projects.yml config.');
    if (isEncrypted) {
      lines.push('Tip: Never store the GPG private key on the backup server.');
    }

    return lines.join('\n');
  }

  private getRestoreCommand(dbType: string, dbName: string): string | null {
    const commands: Record<string, string> = {
      postgres: `pg_restore -h <HOST> -p <PORT> -U <USER> -d ${dbName} <file>.dump`,
      mysql: `mysql -h <HOST> -P <PORT> -u <USER> -p ${dbName} < <file>.sql`,
      mongodb: `mongorestore --host <HOST> --port <PORT> -u <USER> -d ${dbName} --gzip --archive=<file>.archive.gz`,
    };

    return commands[dbType] ?? null;
  }

  private getDumpFileExtension(dbType: string): string {
    const extensions: Record<string, string> = {
      postgres: '.dump',
      mysql: '.sql.gz',
      mongodb: '.archive.gz',
    };

    return extensions[dbType] ?? '.dump';
  }
}
