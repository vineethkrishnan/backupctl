import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { NotifierRegistry } from '@domain/notification/application/registries/notifier.registry';
import { SlackNotifierAdapter } from './slack-notifier.adapter';
import { WebhookNotifierAdapter } from './webhook-notifier.adapter';
import { EmailNotifierAdapter } from './email-notifier.adapter';
import { NOTIFIER_REGISTRY } from '@common/di/injection-tokens';

@Injectable()
export class NotifierBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(NotifierBootstrapService.name);

  constructor(
    @Inject(NOTIFIER_REGISTRY) private readonly registry: NotifierRegistry,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    this.registerSlack();
    this.registerWebhook();
    this.registerEmail();
  }

  private registerSlack(): void {
    const webhookUrl = this.configService.get<string>('SLACK_WEBHOOK_URL');
    if (!webhookUrl) {
      this.logger.debug('Slack notifier not configured (SLACK_WEBHOOK_URL missing)');
      return;
    }
    const timezone = this.configService.get<string>('TIMEZONE', 'Europe/Berlin');
    this.registry.register('slack', new SlackNotifierAdapter(webhookUrl, timezone));
  }

  private registerWebhook(): void {
    const webhookUrl = this.configService.get<string>('WEBHOOK_URL');
    if (!webhookUrl) {
      this.logger.debug('Webhook notifier not configured (WEBHOOK_URL missing)');
      return;
    }
    this.registry.register('webhook', new WebhookNotifierAdapter(webhookUrl));
  }

  private registerEmail(): void {
    const smtpHost = this.configService.get<string>('SMTP_HOST');
    if (!smtpHost) {
      this.logger.debug('Email notifier not configured (SMTP_HOST missing)');
      return;
    }

    this.registry.register(
      'email',
      new EmailNotifierAdapter({
        host: smtpHost,
        port: this.configService.get<number>('SMTP_PORT', 587),
        secure: this.configService.get<string>('SMTP_SECURE', 'false') === 'true',
        user: this.configService.get<string>('SMTP_USER', ''),
        password: this.configService.get<string>('SMTP_PASSWORD', ''),
        to: this.configService.get<string>('SMTP_TO', ''),
        from: this.configService.get<string>('SMTP_FROM', 'backupctl@localhost'),
        timezone: this.configService.get<string>('TIMEZONE', 'Europe/Berlin'),
      }),
    );
  }
}
