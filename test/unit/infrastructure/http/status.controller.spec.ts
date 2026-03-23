import { StatusController } from '@domain/audit/presenters/http/status.controller';
import { GetBackupStatusUseCase } from '@domain/audit/application/use-cases/get-backup-status/get-backup-status.use-case';
import { BackupResult } from '@domain/backup/domain/backup-result.model';
import { BackupStatus } from '@domain/backup/domain/value-objects/backup-status.enum';
import { BackupStage } from '@domain/backup/domain/value-objects/backup-stage.enum';

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
    backupType: 'database',
    snapshotMode: 'combined',
    errorStage: null,
    errorMessage: null,
    retryCount: 0,
    durationMs: 300000,
  });
}

describe('StatusController', () => {
  let controller: StatusController;
  let getBackupStatus: jest.Mocked<GetBackupStatusUseCase>;

  beforeEach(() => {
    getBackupStatus = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<GetBackupStatusUseCase>;

    controller = new StatusController(getBackupStatus);
  });

  describe('getAllStatus', () => {
    it('should return all project statuses', async () => {
      const mockResults = [createMockResult('vinsware'), createMockResult('shopify')];
      getBackupStatus.execute.mockResolvedValue(mockResults);

      const response = await controller.getAllStatus();

      expect(getBackupStatus.execute).toHaveBeenCalledWith(
        expect.objectContaining({ projectName: undefined, limit: undefined }),
      );
      expect(response).toEqual({ projects: mockResults });
    });

    it('should pass parsed limit from query parameter', async () => {
      getBackupStatus.execute.mockResolvedValue([]);

      await controller.getAllStatus('5');

      expect(getBackupStatus.execute).toHaveBeenCalledWith(
        expect.objectContaining({ projectName: undefined, limit: 5 }),
      );
    });

    it('should handle missing limit parameter', async () => {
      getBackupStatus.execute.mockResolvedValue([]);

      await controller.getAllStatus(undefined);

      expect(getBackupStatus.execute).toHaveBeenCalledWith(
        expect.objectContaining({ projectName: undefined, limit: undefined }),
      );
    });
  });

  describe('getProjectStatus', () => {
    it('should return specific project history', async () => {
      const mockResults = [createMockResult('vinsware')];
      getBackupStatus.execute.mockResolvedValue(mockResults);

      const response = await controller.getProjectStatus('vinsware');

      expect(getBackupStatus.execute).toHaveBeenCalledWith(
        expect.objectContaining({ projectName: 'vinsware', limit: undefined }),
      );
      expect(response).toEqual({ project: 'vinsware', history: mockResults });
    });

    it('should pass parsed limit for project status', async () => {
      getBackupStatus.execute.mockResolvedValue([]);

      await controller.getProjectStatus('vinsware', '10');

      expect(getBackupStatus.execute).toHaveBeenCalledWith(
        expect.objectContaining({ projectName: 'vinsware', limit: 10 }),
      );
    });
  });
});
