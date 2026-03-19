import { CommandFactory } from 'nest-commander';
import { AppModule } from './app/app.module';

async function bootstrap() {
  await CommandFactory.run(AppModule, {
    logger: ['warn', 'error'],
    errorHandler: (error) => {
      console.error(error.message);
      process.exitCode = process.exitCode || 1;
    },
  });
}

void bootstrap();
