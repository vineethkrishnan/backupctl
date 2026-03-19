import { ConfigService } from '@nestjs/config';
import { NotifierBootstrapService } from '@domain/notification/infrastructure/notifier-bootstrap.service';
import { NotifierRegistry } from '@domain/notification/application/registries/notifier.registry';

describe('NotifierBootstrapService', () => {
  let registry: NotifierRegistry;

  function buildService(envValues: Record<string, string | undefined>): NotifierBootstrapService {
    const configService = {
      get: jest.fn((key: string, defaultValue?: unknown) => envValues[key] ?? defaultValue),
    } as unknown as ConfigService;

    return new NotifierBootstrapService(registry, configService);
  }

  beforeEach(() => {
    registry = new NotifierRegistry();
  });

  it('registers slack notifier when SLACK_WEBHOOK_URL is set', () => {
    const service = buildService({ SLACK_WEBHOOK_URL: 'https://hooks.slack.com/test' });

    service.onModuleInit();

    expect(registry.getRegisteredTypes()).toContain('slack');
  });

  it('skips slack when SLACK_WEBHOOK_URL is missing', () => {
    const service = buildService({});

    service.onModuleInit();

    expect(registry.getRegisteredTypes()).not.toContain('slack');
  });

  it('registers webhook notifier when WEBHOOK_URL is set', () => {
    const service = buildService({ WEBHOOK_URL: 'https://example.com/hook' });

    service.onModuleInit();

    expect(registry.getRegisteredTypes()).toContain('webhook');
  });

  it('skips webhook when WEBHOOK_URL is missing', () => {
    const service = buildService({});

    service.onModuleInit();

    expect(registry.getRegisteredTypes()).not.toContain('webhook');
  });

  it('registers email notifier when SMTP_HOST is set', () => {
    const service = buildService({
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_USER: 'user',
      SMTP_PASSWORD: 'pass',
      SMTP_TO: 'admin@example.com',
      SMTP_FROM: 'backup@example.com',
    });

    service.onModuleInit();

    expect(registry.getRegisteredTypes()).toContain('email');
  });

  it('skips email when SMTP_HOST is missing', () => {
    const service = buildService({});

    service.onModuleInit();

    expect(registry.getRegisteredTypes()).not.toContain('email');
  });

  it('registers all three when all env vars present', () => {
    const service = buildService({
      SLACK_WEBHOOK_URL: 'https://hooks.slack.com/test',
      WEBHOOK_URL: 'https://example.com/hook',
      SMTP_HOST: 'smtp.example.com',
    });

    service.onModuleInit();

    expect(registry.getRegisteredTypes()).toEqual(
      expect.arrayContaining(['slack', 'webhook', 'email']),
    );
  });

  it('registers nothing when no env vars present', () => {
    const service = buildService({});

    service.onModuleInit();

    expect(registry.getRegisteredTypes()).toEqual([]);
  });
});
