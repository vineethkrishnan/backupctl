import { Controller, Get, Param, Query } from '@nestjs/common';
import { GetBackupStatusUseCase } from '@domain/audit/application/use-cases/get-backup-status/get-backup-status.use-case';
import { GetBackupStatusQuery } from '@domain/audit/application/use-cases/get-backup-status/get-backup-status.query';

@Controller('status')
export class StatusController {
  constructor(private readonly getBackupStatus: GetBackupStatusUseCase) {}

  @Get()
  async getAllStatus(@Query('last') last?: string) {
    const limit = last ? parseInt(last, 10) : undefined;
    const results = await this.getBackupStatus.execute(
      new GetBackupStatusQuery({ limit }),
    );
    return { projects: results };
  }

  @Get(':project')
  async getProjectStatus(@Param('project') project: string, @Query('last') last?: string) {
    const limit = last ? parseInt(last, 10) : undefined;
    const results = await this.getBackupStatus.execute(
      new GetBackupStatusQuery({ projectName: project, limit }),
    );
    return { project, history: results };
  }
}
