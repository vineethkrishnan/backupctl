import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));
  const port = process.env.APP_PORT ?? 3100;
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
