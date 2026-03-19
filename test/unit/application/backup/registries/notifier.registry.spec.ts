import { NotifierPort } from '@domain/notification/application/ports/notifier.port';
import { NotifierRegistry } from '@domain/notification/application/registries/notifier.registry';

describe('NotifierRegistry', () => {
  let registry: NotifierRegistry;
  let mockNotifier: NotifierPort;

  beforeEach(() => {
    registry = new NotifierRegistry();
    mockNotifier = {
      notifyStarted: jest.fn(),
      notifySuccess: jest.fn(),
      notifyFailure: jest.fn(),
      notifyWarning: jest.fn(),
      notifyDailySummary: jest.fn(),
    } as unknown as NotifierPort;
  });

  it('registers and resolves a notifier by type', () => {
    registry.register('slack', mockNotifier);

    const resolved = registry.resolve('slack');

    expect(resolved).toBe(mockNotifier);
  });

  it('resolve is case-insensitive (register slack, resolve SLACK)', () => {
    registry.register('slack', mockNotifier);

    const resolved = registry.resolve('SLACK');

    expect(resolved).toBe(mockNotifier);
  });

  it('resolve unknown type throws with descriptive message', () => {
    expect(() => registry.resolve('unknown')).toThrow(
      'No notifier registered for type: unknown',
    );
  });

  it('getRegisteredTypes returns all registered types', () => {
    registry.register('slack', mockNotifier);
    registry.register('email', mockNotifier);
    registry.register('webhook', mockNotifier);

    const types = registry.getRegisteredTypes();

    expect(types).toEqual(['slack', 'email', 'webhook']);
  });

  it('re-registering same type overwrites previous notifier', () => {
    const firstNotifier: NotifierPort = {
      notifyStarted: jest.fn(),
      notifySuccess: jest.fn(),
      notifyFailure: jest.fn(),
      notifyWarning: jest.fn(),
      notifyDailySummary: jest.fn(),
    };
    const secondNotifier: NotifierPort = {
      notifyStarted: jest.fn(),
      notifySuccess: jest.fn(),
      notifyFailure: jest.fn(),
      notifyWarning: jest.fn(),
      notifyDailySummary: jest.fn(),
    };

    registry.register('slack', firstNotifier);
    registry.register('slack', secondNotifier);

    const resolved = registry.resolve('slack');

    expect(resolved).toBe(secondNotifier);
  });
});
