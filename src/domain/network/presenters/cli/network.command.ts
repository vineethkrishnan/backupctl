import { Command, CommandRunner, SubCommand } from 'nest-commander';
import { ConnectNetworkUseCase } from '../../application/use-cases/connect-network/connect-network.use-case';
import { ConnectNetworkCommand } from '../../application/use-cases/connect-network/connect-network.command';
import { NetworkConnectResult } from '../../domain/network-connect-result.model';

const STATUS_ICONS: Record<string, string> = {
  connected: '✓',
  already_connected: '-',
  skipped: '-',
  failed: '✗',
};

@SubCommand({ name: 'connect', description: 'Connect backupctl container to project Docker networks', arguments: '[project]' })
export class NetworkConnectSubCommand extends CommandRunner {
  constructor(private readonly connectNetwork: ConnectNetworkUseCase) { super(); }

  async run(params: string[]): Promise<void> {
    const projectName = params[0];
    const command = new ConnectNetworkCommand({ projectName });

    console.log('Connecting backupctl to project Docker networks...\n');
    const results = await this.connectNetwork.execute(command);

    // Print results
    for (const result of results) {
      this.printResult(result);
    }

    // Summary
    const connected = results.filter((r) => r.status === 'connected').length;
    const alreadyConnected = results.filter((r) => r.status === 'already_connected').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    const failed = results.filter((r) => r.status === 'failed').length;

    const parts: string[] = [];
    if (connected > 0) { parts.push(`${connected} connected`); }
    if (alreadyConnected > 0) { parts.push(`${alreadyConnected} already connected`); }
    if (skipped > 0) { parts.push(`${skipped} skipped`); }
    if (failed > 0) { parts.push(`${failed} failed`); }
    console.log(`\nSummary: ${parts.join(', ')}`);

    // Exit codes
    if (failed > 0 && failed === results.length) {
      process.exitCode = 1;
    } else if (failed > 0) {
      process.exitCode = 5;
    }
  }

  private printResult(result: NetworkConnectResult): void {
    const icon = STATUS_ICONS[result.status] ?? '?';
    console.log(`  ${icon} ${result.projectName} — ${result.message}`);
  }
}

@Command({ name: 'network', description: 'Docker network management', subCommands: [NetworkConnectSubCommand] })
export class NetworkCommand extends CommandRunner {
  run(): Promise<void> {
    console.log('Usage: backupctl network <connect>');
    return Promise.resolve();
  }
}
