import { Module } from '@nestjs/common';

import { RunCommand } from './commands/run.command';
import { StatusCommand } from './commands/status.command';
import { HealthCommand } from './commands/health.command';
import { RestoreCommand } from './commands/restore.command';
import { SnapshotsCommand } from './commands/snapshots.command';
import { PruneCommand } from './commands/prune.command';
import { LogsCommand } from './commands/logs.command';
import {
  CacheCommand,
} from './commands/cache.command';
import {
  ConfigCommand,
  ConfigValidateSubCommand,
  ConfigShowSubCommand,
  ConfigReloadSubCommand,
  ConfigImportGpgKeySubCommand,
} from './commands/config.command';
import { ResticCommand } from './commands/restic.command';

@Module({
  providers: [
    RunCommand,
    StatusCommand,
    HealthCommand,
    RestoreCommand,
    SnapshotsCommand,
    PruneCommand,
    LogsCommand,
    CacheCommand,
    ConfigCommand,
    ConfigValidateSubCommand,
    ConfigShowSubCommand,
    ConfigReloadSubCommand,
    ConfigImportGpgKeySubCommand,
    ResticCommand,
  ],
})
export class CliModule {}
