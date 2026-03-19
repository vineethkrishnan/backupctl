import { DatabaseDumperPort } from '@domain/backup/application/ports/database-dumper.port';

export class DumperRegistry {
  private readonly dumpers = new Map<string, DatabaseDumperPort>();

  register(type: string, dumper: DatabaseDumperPort): void {
    this.dumpers.set(type.toLowerCase(), dumper);
  }

  resolve(type: string): DatabaseDumperPort {
    const dumper = this.dumpers.get(type.toLowerCase());
    if (!dumper) {
      throw new Error(`No database dumper registered for type: ${type}`);
    }
    return dumper;
  }

  getRegisteredTypes(): string[] {
    return Array.from(this.dumpers.keys());
  }
}
