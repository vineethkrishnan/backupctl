import { DatabaseDumperPort } from '@domain/backup/application/ports/database-dumper.port';
import { ProjectConfig } from '@domain/config/domain/project-config.model';

export type DumperFactory = (config: ProjectConfig) => DatabaseDumperPort;

export class DumperRegistry {
  private readonly factories = new Map<string, DumperFactory>();

  register(type: string, factory: DumperFactory): void {
    this.factories.set(type.toLowerCase(), factory);
  }

  create(type: string, config: ProjectConfig): DatabaseDumperPort {
    const factory = this.factories.get(type.toLowerCase());
    if (!factory) {
      throw new Error(`No database dumper registered for type: ${type}`);
    }
    return factory(config);
  }

  has(type: string): boolean {
    return this.factories.has(type.toLowerCase());
  }

  getRegisteredTypes(): string[] {
    return Array.from(this.factories.keys());
  }
}
