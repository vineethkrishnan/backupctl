import { Inject, Injectable } from '@nestjs/common';
import { AuditLogPort } from '@domain/audit/ports/audit-log.port';
import { AuditQueryUseCase } from '@domain/audit/ports/audit-query.use-case';
import { BackupResult } from '@domain/backup/models/backup-result.model';
import { ConfigLoaderPort } from '@domain/config/ports/config-loader.port';
import { AUDIT_LOG_PORT, CONFIG_LOADER_PORT } from '@shared/injection-tokens';

@Injectable()
export class AuditQueryService implements AuditQueryUseCase {
  constructor(
    @Inject(AUDIT_LOG_PORT) private readonly auditLog: AuditLogPort,
    @Inject(CONFIG_LOADER_PORT) private readonly configLoader: ConfigLoaderPort,
  ) {}

  async getStatus(projectName?: string, limit?: number): Promise<BackupResult[]> {
    if (projectName) {
      return this.auditLog.findByProject(projectName, limit);
    }

    // Aggregate results across all configured projects
    const projects = this.configLoader.loadAll();
    const results: BackupResult[] = [];

    for (const project of projects) {
      const projectResults = await this.auditLog.findByProject(project.name, limit);
      results.push(...projectResults);
    }

    return results;
  }

  async getFailedLogs(projectName: string, limit?: number): Promise<BackupResult[]> {
    return this.auditLog.findFailed(projectName, limit);
  }
}
