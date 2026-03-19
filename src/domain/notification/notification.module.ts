import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { NotifierRegistry } from './application/registries/notifier.registry';
import { NotifierBootstrapService } from './infrastructure/notifier-bootstrap.service';
import { NOTIFIER_REGISTRY } from '@common/di/injection-tokens';

@Module({
  imports: [ConfigModule],
  providers: [
    { provide: NOTIFIER_REGISTRY, useClass: NotifierRegistry },
    NotifierBootstrapService,
  ],
  exports: [NOTIFIER_REGISTRY],
})
export class NotificationModule {}
