import { Module } from '@nestjs/common';
import { ConnectNetworkUseCase } from './application/use-cases/connect-network/connect-network.use-case';
import { DockerCliNetworkAdapter } from './infrastructure/adapters/docker-cli-network.adapter';
import { NetworkCommand, NetworkConnectSubCommand } from './presenters/cli/network.command';
import { DOCKER_NETWORK_PORT } from '@common/di/injection-tokens';

@Module({
  providers: [
    ConnectNetworkUseCase,
    { provide: DOCKER_NETWORK_PORT, useClass: DockerCliNetworkAdapter },
    NetworkCommand,
    NetworkConnectSubCommand,
  ],
})
export class NetworkModule {}
