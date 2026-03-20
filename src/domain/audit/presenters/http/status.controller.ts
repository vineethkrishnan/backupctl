import { Controller, Get, Param, Query } from '@nestjs/common';
import { GetBackupStatusUseCase } from '@domain/audit/application/use-cases/get-backup-status/get-backup-status.use-case';
import { GetBackupStatusQuery } from '@domain/audit/application/use-cases/get-backup-status/get-backup-status.query';

@Controller('status')
export class StatusController {
  constructor(private readonly getBackupStatus: GetBackupStatusUseCase) {}

  @Get()
  async getAllStatus(
    @Query('last') last?: string,
  ): Promise<{ projects: Awaited<ReturnType<GetBackupStatusUseCase['execute']>> }> {
    const limit = last ? this.parseLimit(last) : undefined;
    const results = await this.getBackupStatus.execute(
      new GetBackupStatusQuery({ limit }),
    );
    return { projects: results };
  }

  @Get(':project')
  async getProjectStatus(
    @Param('project') project: string,
    @Query('last') last?: string,
  ): Promise<{ project: string; history: Awaited<ReturnType<GetBackupStatusUseCase['execute']>> }> {
    const limit = last ? this.parseLimit(last) : undefined;
    const results = await this.getBackupStatus.execute(
      new GetBackupStatusQuery({ projectName: project, limit }),
    );
    return { project, history: results };
  }

  private parseLimit(value: string): number {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed) || parsed < 1) return 20;
    return Math.min(parsed, 1000);
  }
}
