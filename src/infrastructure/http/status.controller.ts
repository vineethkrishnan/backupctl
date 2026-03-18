import { Controller, Get, Param, Query } from '@nestjs/common';
import { AuditQueryService } from '@application/audit/audit-query.service';

@Controller('status')
export class StatusController {
  constructor(private readonly auditQueryService: AuditQueryService) {}

  @Get()
  async getAllStatus(@Query('last') last?: string) {
    const limit = last ? parseInt(last, 10) : undefined;
    const results = await this.auditQueryService.getStatus(undefined, limit);
    return { projects: results };
  }

  @Get(':project')
  async getProjectStatus(
    @Param('project') project: string,
    @Query('last') last?: string,
  ) {
    const limit = last ? parseInt(last, 10) : undefined;
    const results = await this.auditQueryService.getStatus(project, limit);
    return { project, history: results };
  }
}
