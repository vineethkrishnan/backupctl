import { Inject, Injectable } from '@nestjs/common';
import { AuditLogPort } from '@domain/audit/application/ports/audit-log.port';
import { BackupResult } from '@domain/backup/domain/backup-result.model';
import { ConfigLoaderPort } from '@domain/config/application/ports/config-loader.port';
import { AUDIT_LOG_PORT, CONFIG_LOADER_PORT } from '@common/di/injection-tokens';
import { GetBackupStatusQuery } from './get-backup-status.query';

@Injectable()
export class GetBackupStatusUseCase {
  constructor(
    @Inject(AUDIT_LOG_PORT) private readonly auditLog: AuditLogPort,
    @Inject(CONFIG_LOADER_PORT) private readonly configLoader: ConfigLoaderPort,
  ) {}

  async execute(query: GetBackupStatusQuery): Promise<BackupResult[]> {
    if (query.projectName) {
      return this.auditLog.findByProject(query.projectName, query.limit);
    }

    const projects = this.configLoader.loadAll();
    const results: BackupResult[] = [];

    for (const project of projects) {
      const projectResults = await this.auditLog.findByProject(project.name, query.limit);
      results.push(...projectResults);
    }

    return results;
  }
}
