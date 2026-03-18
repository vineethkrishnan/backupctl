import { NotifierPort } from '@domain/notification/ports/notifier.port';

export class NotifierRegistry {
  private readonly notifiers = new Map<string, NotifierPort>();

  register(type: string, notifier: NotifierPort): void {
    this.notifiers.set(type.toLowerCase(), notifier);
  }

  resolve(type: string): NotifierPort {
    const notifier = this.notifiers.get(type.toLowerCase());
    if (!notifier) {
      throw new Error(`No notifier registered for type: ${type}`);
    }
    return notifier;
  }

  getRegisteredTypes(): string[] {
    return Array.from(this.notifiers.keys());
  }
}
