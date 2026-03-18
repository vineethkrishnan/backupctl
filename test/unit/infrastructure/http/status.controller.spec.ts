import { StatusController } from '@infrastructure/http/status.controller';
import { AuditQueryService } from '@application/audit/audit-query.service';
import { BackupResult } from '@domain/backup/models/backup-result.model';
import { BackupStatus } from '@domain/backup/models/backup-status.enum';
import { BackupStage } from '@domain/backup/models/backup-stage.enum';

function createMockResult(projectName: string): BackupResult {
  return new BackupResult({
    runId: 'run-1',
    projectName,
    status: BackupStatus.Success,
    currentStage: BackupStage.NotifyResult,
    startedAt: new Date('2026-03-18T02:00:00Z'),
    completedAt: new Date('2026-03-18T02:05:00Z'),
    dumpResult: null,
    syncResult: null,
    pruneResult: null,
    cleanupResult: null,
    encrypted: false,
    verified: false,
    snapshotMode: 'combined',
    errorStage: null,
    errorMessage: null,
    retryCount: 0,
    durationMs: 300000,
  });
}

describe('StatusController', () => {
  let controller: StatusController;
  let auditQueryService: jest.Mocked<AuditQueryService>;

  beforeEach(() => {
    auditQueryService = {
      getStatus: jest.fn(),
      getFailedLogs: jest.fn(),
    } as unknown as jest.Mocked<AuditQueryService>;

    controller = new StatusController(auditQueryService);
  });

  describe('getAllStatus', () => {
    it('should return all project statuses', async () => {
      const mockResults = [createMockResult('locaboo'), createMockResult('shopify')];
      auditQueryService.getStatus.mockResolvedValue(mockResults);

      const response = await controller.getAllStatus();

      expect(auditQueryService.getStatus).toHaveBeenCalledWith(undefined, undefined);
      expect(response).toEqual({ projects: mockResults });
    });

    it('should pass parsed limit from query parameter', async () => {
      auditQueryService.getStatus.mockResolvedValue([]);

      await controller.getAllStatus('5');

      expect(auditQueryService.getStatus).toHaveBeenCalledWith(undefined, 5);
    });

    it('should handle missing limit parameter', async () => {
      auditQueryService.getStatus.mockResolvedValue([]);

      await controller.getAllStatus(undefined);

      expect(auditQueryService.getStatus).toHaveBeenCalledWith(undefined, undefined);
    });
  });

  describe('getProjectStatus', () => {
    it('should return specific project history', async () => {
      const mockResults = [createMockResult('locaboo')];
      auditQueryService.getStatus.mockResolvedValue(mockResults);

      const response = await controller.getProjectStatus('locaboo');

      expect(auditQueryService.getStatus).toHaveBeenCalledWith('locaboo', undefined);
      expect(response).toEqual({ project: 'locaboo', history: mockResults });
    });

    it('should pass parsed limit for project status', async () => {
      auditQueryService.getStatus.mockResolvedValue([]);

      await controller.getProjectStatus('locaboo', '10');

      expect(auditQueryService.getStatus).toHaveBeenCalledWith('locaboo', 10);
    });
  });
});
