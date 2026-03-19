import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

import { YamlConfigLoaderAdapter } from './infrastructure/yaml-config-loader.adapter';
import { ConfigCommand, ConfigValidateSubCommand, ConfigShowSubCommand, ConfigReloadSubCommand, ConfigImportGpgKeySubCommand } from './presenters/cli/config.command';

import { CONFIG_LOADER_PORT } from '@common/di/injection-tokens';

@Global()
@Module({
  imports: [NestConfigModule],
  providers: [
    { provide: CONFIG_LOADER_PORT, useClass: YamlConfigLoaderAdapter },
    ConfigCommand,
    ConfigValidateSubCommand,
    ConfigShowSubCommand,
    ConfigReloadSubCommand,
    ConfigImportGpgKeySubCommand,
  ],
  exports: [CONFIG_LOADER_PORT],
})
export class ConfigAppModule {}
