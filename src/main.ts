import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app/app.module';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { printDevBanner } from '@common/helpers/dev-banner.util';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Logging
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));

  // Security headers
  app.use(helmet());

  // No browser clients — disable CORS entirely
  app.enableCors({ origin: false });

  // Strip query/param input to declared types, reject unknowns
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Allow in-flight backups to finish on SIGTERM
  app.enableShutdownHooks();

  const port = process.env.APP_PORT ?? 3100;
  await app.listen(port, '0.0.0.0');
  printDevBanner(port);
}

void bootstrap();
