export interface DockerNetworkPort {
  connectContainer(containerName: string, networkName: string): Promise<void>;
  isContainerConnected(containerName: string, networkName: string): Promise<boolean>;
  networkExists(networkName: string): Promise<boolean>;
}
