import { Inject, Injectable } from '@nestjs/common';
import { AuditLogPort } from '@domain/audit/application/ports/audit-log.port';
import { BackupResult } from '@domain/backup/domain/backup-result.model';
import { AUDIT_LOG_PORT } from '@common/di/injection-tokens';
import { GetFailedLogsQuery } from './get-failed-logs.query';

@Injectable()
export class GetFailedLogsUseCase {
  constructor(
    @Inject(AUDIT_LOG_PORT) private readonly auditLog: AuditLogPort,
  ) {}

  async execute(query: GetFailedLogsQuery): Promise<BackupResult[]> {
    return this.auditLog.findFailed(query.projectName, query.limit);
  }
}
