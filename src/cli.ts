import { CommandFactory } from 'nest-commander';
import { LogLevel } from '@nestjs/common';
import { AppModule } from './app/app.module';

// Signal to OnModuleInit hooks that this is a short-lived CLI process
process.env.BACKUPCTL_CLI_MODE = '1';

// Parse --verbose / -v before NestJS bootstrap so it affects logger initialization
const isVerbose =
  process.argv.includes('--verbose') || process.argv.includes('-v');

if (isVerbose) {
  process.env.LOG_LEVEL = 'debug';
  // Strip the flag so nest-commander doesn't choke on an unknown global option
  process.argv = process.argv.filter((a) => a !== '--verbose' && a !== '-v');
}

const loggerLevels: LogLevel[] = isVerbose
  ? ['log', 'error', 'warn', 'debug', 'verbose']
  : ['warn', 'error'];

async function bootstrap() {
  await CommandFactory.run(AppModule, {
    logger: loggerLevels,
    errorHandler: (error) => {
      console.error(error.message);
      process.exitCode = process.exitCode ?? 1;
    },
  });
}

void bootstrap();
