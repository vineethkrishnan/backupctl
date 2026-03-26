import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigLoaderPort } from '@domain/config/application/ports/config-loader.port';
import { ProjectConfig } from '@domain/config/domain/project-config.model';
import { DockerNetworkPort } from '../../ports/docker-network.port';
import { NetworkConnectResult } from '../../../domain/network-connect-result.model';
import { ConnectNetworkCommand } from './connect-network.command';
import { CONFIG_LOADER_PORT, DOCKER_NETWORK_PORT } from '@common/di/injection-tokens';

@Injectable()
export class ConnectNetworkUseCase {
  constructor(
    @Inject(CONFIG_LOADER_PORT) private readonly configLoader: ConfigLoaderPort,
    @Inject(DOCKER_NETWORK_PORT) private readonly dockerNetwork: DockerNetworkPort,
    private readonly configService: ConfigService,
  ) {}

  async execute(command: ConnectNetworkCommand): Promise<NetworkConnectResult[]> {
    const containerName = this.configService.get<string>('BACKUPCTL_CONTAINER_NAME', 'backupctl');

    // Resolve target projects
    const projects = command.projectName
      ? [this.configLoader.getProject(command.projectName)]
      : this.configLoader.loadAll();

    const results: NetworkConnectResult[] = [];

    for (const project of projects) {
      const result = await this.connectProject(containerName, project);
      results.push(result);
    }

    return results;
  }

  private async connectProject(containerName: string, project: ProjectConfig): Promise<NetworkConnectResult> {
    if (!project.dockerNetwork) {
      return new NetworkConnectResult({
        projectName: project.name,
        networkName: '',
        status: 'skipped',
        message: 'no docker_network configured',
      });
    }

    const networkName = project.dockerNetwork;

    try {
      // Check if network exists
      const exists = await this.dockerNetwork.networkExists(networkName);
      if (!exists) {
        return new NetworkConnectResult({
          projectName: project.name,
          networkName,
          status: 'failed',
          message: `network '${networkName}' does not exist`,
        });
      }

      // Check if already connected
      const isConnected = await this.dockerNetwork.isContainerConnected(containerName, networkName);
      if (isConnected) {
        return new NetworkConnectResult({
          projectName: project.name,
          networkName,
          status: 'already_connected',
          message: `already connected to ${networkName}`,
        });
      }

      // Connect
      await this.dockerNetwork.connectContainer(containerName, networkName);
      return new NetworkConnectResult({
        projectName: project.name,
        networkName,
        status: 'connected',
        message: `connected to ${networkName}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return new NetworkConnectResult({
        projectName: project.name,
        networkName,
        status: 'failed',
        message,
      });
    }
  }
}
