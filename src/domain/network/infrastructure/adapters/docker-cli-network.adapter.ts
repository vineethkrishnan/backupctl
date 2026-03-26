import { Injectable } from '@nestjs/common';
import { DockerNetworkPort } from '../../application/ports/docker-network.port';
import { safeExecFile } from '@common/helpers/child-process.util';

@Injectable()
export class DockerCliNetworkAdapter implements DockerNetworkPort {
  async connectContainer(containerName: string, networkName: string): Promise<void> {
    await safeExecFile('docker', ['network', 'connect', networkName, containerName], { timeout: 30000 });
  }

  async isContainerConnected(containerName: string, networkName: string): Promise<boolean> {
    const { stdout } = await safeExecFile(
      'docker',
      ['inspect', '--format', '{{json .NetworkSettings.Networks}}', containerName],
      { timeout: 15000 },
    );
    const networks = JSON.parse(stdout.trim()) as Record<string, unknown>;
    return networkName in networks;
  }

  async networkExists(networkName: string): Promise<boolean> {
    try {
      await safeExecFile('docker', ['network', 'inspect', networkName], { timeout: 15000 });
      return true;
    } catch {
      return false;
    }
  }
}
