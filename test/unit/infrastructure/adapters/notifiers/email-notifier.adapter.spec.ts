import { EmailNotifierAdapter, SmtpConfig } from '@domain/notification/infrastructure/email-notifier.adapter';
import { BackupResult } from '@domain/backup/domain/backup-result.model';
import { BackupStageError } from '@domain/backup/domain/backup-stage-error';
import { BackupStage } from '@domain/backup/domain/value-objects/backup-stage.enum';
import { BackupStatus } from '@domain/backup/domain/value-objects/backup-status.enum';
import { DumpResult } from '@domain/backup/domain/value-objects/dump-result.model';
import { SyncResult } from '@domain/backup/domain/value-objects/sync-result.model';
import { PruneResult } from '@domain/backup/domain/value-objects/prune-result.model';
import { CleanupResult } from '@domain/backup/domain/value-objects/cleanup-result.model';

const mockSendMail = jest.fn().mockResolvedValue({ messageId: 'test-id' });
const mockCreateTransport = jest.fn().mockReturnValue({ sendMail: mockSendMail });

jest.mock('nodemailer', () => ({
  createTransport: (...args: unknown[]) => mockCreateTransport(...args),
}));

describe('EmailNotifierAdapter', () => {
  const smtpConfig: SmtpConfig = {
    host: 'smtp.gmail.com',
    port: 587,
    secure: true,
    user: 'backup@company.com',
    password: 'secret-password',
    to: 'devops@company.com',
    from: 'backup@company.com',
  };

  let adapter: EmailNotifierAdapter;

  beforeEach(() => {
    adapter = new EmailNotifierAdapter(smtpConfig);
    mockSendMail.mockClear();
    mockCreateTransport.mockClear();
  });

  function createSuccessResult(overrides?: Partial<ConstructorParameters<typeof BackupResult>[0]>): BackupResult {
    return new BackupResult({
      runId: 'run-123',
      projectName: 'locaboo',
      status: BackupStatus.Success,
      currentStage: BackupStage.NotifyResult,
      startedAt: new Date('2026-03-18T00:00:00Z'),
      completedAt: new Date('2026-03-18T00:03:12Z'),
      dumpResult: new DumpResult('/data/backups/locaboo/backup.sql.gz', 257949696, 45000),
      syncResult: new SyncResult('a1b2c3d4', 12, 3, 54525952, 120000),
      pruneResult: new PruneResult(2, '150 MB'),
      cleanupResult: new CleanupResult(1, 1048576),
      encrypted: true,
      verified: true,
      backupType: 'database',
      snapshotMode: 'combined',
      errorStage: null,
      errorMessage: null,
      retryCount: 0,
      durationMs: 192000,
      ...overrides,
    });
  }

  describe('constructor', () => {
    it('should create transporter with smtp_secure setting', () => {
      new EmailNotifierAdapter(smtpConfig);

      expect(mockCreateTransport).toHaveBeenCalledWith({
        host: 'smtp.gmail.com',
        port: 587,
        secure: true,
        auth: {
          user: 'backup@company.com',
          pass: 'secret-password',
        },
      });
    });

    it('should create transporter with secure false when configured', () => {
      const insecureConfig = { ...smtpConfig, secure: false };

      new EmailNotifierAdapter(insecureConfig);

      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({ secure: false }),
      );
    });
  });

  describe('notifyStarted', () => {
    it('should send email with correct subject', async () => {
      await adapter.notifyStarted('locaboo');

      expect(mockSendMail).toHaveBeenCalledTimes(1);
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: '🔄 Backup started — locaboo',
          from: 'backup@company.com',
          to: 'devops@company.com',
        }),
      );
    });

    it('should include time in email body', async () => {
      await adapter.notifyStarted('locaboo');

      const htmlBody = mockSendMail.mock.calls[0][0].html as string;
      expect(htmlBody).toContain('Backup started');
      expect(htmlBody).toContain('Time:');
    });
  });

  describe('notifySuccess', () => {
    it('should send email with formatted body', async () => {
      const result = createSuccessResult();

      await adapter.notifySuccess(result);

      expect(mockSendMail).toHaveBeenCalledTimes(1);
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: '✅ Backup completed — locaboo',
        }),
      );

      const htmlBody = mockSendMail.mock.calls[0][0].html as string;
      expect(htmlBody).toContain('Backup completed — locaboo');
      expect(htmlBody).toContain('246.00 MB');
      expect(htmlBody).toContain('Encrypted');
      expect(htmlBody).toContain('Yes');
      expect(htmlBody).toContain('a1b2c3d4');
      expect(htmlBody).toContain('3m 12s');
    });

    it('should show N/A when dumpResult is null', async () => {
      const result = createSuccessResult({ dumpResult: null });

      await adapter.notifySuccess(result);

      const htmlBody = mockSendMail.mock.calls[0][0].html as string;
      expect(htmlBody).toContain('N/A');
    });

    it('should omit sync/prune/cleanup rows when they are null', async () => {
      const result = createSuccessResult({
        syncResult: null,
        pruneResult: null,
        cleanupResult: null,
      });

      await adapter.notifySuccess(result);

      const htmlBody = mockSendMail.mock.calls[0][0].html as string;
      expect(htmlBody).not.toContain('Snapshot');
      expect(htmlBody).not.toContain('Pruned');
      expect(htmlBody).not.toContain('Local Cleaned');
    });
  });

  describe('notifyFailure', () => {
    it('should send email with error details', async () => {
      const error = new BackupStageError(
        BackupStage.Sync,
        new Error('connection timeout'),
        true,
      );

      await adapter.notifyFailure('locaboo', error);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: '❌ Backup failed — locaboo',
        }),
      );

      const htmlBody = mockSendMail.mock.calls[0][0].html as string;
      expect(htmlBody).toContain('Backup failed — locaboo');
      expect(htmlBody).toContain('sync');
      expect(htmlBody).toContain('connection timeout');
    });
  });

  describe('notifyWarning', () => {
    it('should send email with warning subject and message', async () => {
      await adapter.notifyWarning('locaboo', 'Backup exceeded timeout threshold');

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: '⚠️ Backup warning — locaboo',
        }),
      );

      const htmlBody = mockSendMail.mock.calls[0][0].html as string;
      expect(htmlBody).toContain('Backup exceeded timeout threshold');
    });
  });

  describe('notifyDailySummary', () => {
    it('should send email with summary subject and content', async () => {
      const results = [
        createSuccessResult(),
        createSuccessResult({
          projectName: 'project-y',
          status: BackupStatus.Failed,
          errorMessage: 'sync timeout',
          dumpResult: null,
          syncResult: null,
          pruneResult: null,
          cleanupResult: null,
        }),
      ];

      await adapter.notifyDailySummary(results);

      expect(mockSendMail).toHaveBeenCalledTimes(1);
      const call = mockSendMail.mock.calls[0][0];
      expect(call.subject).toContain('📊 Daily Backup Summary');

      const htmlBody = call.html as string;
      expect(htmlBody).toContain('locaboo');
      expect(htmlBody).toContain('project-y');
      expect(htmlBody).toContain('FAILED');
      expect(htmlBody).toContain('1/2 successful');
    });

    it('should show unknown error when errorMessage is null', async () => {
      const results = [
        createSuccessResult({
          projectName: 'project-z',
          status: BackupStatus.Failed,
          errorMessage: null,
          dumpResult: null,
          syncResult: null,
        }),
      ];

      await adapter.notifyDailySummary(results);

      const htmlBody = mockSendMail.mock.calls[0][0].html as string;
      expect(htmlBody).toContain('unknown error');
    });

    it('should show N/A for successful result without syncResult', async () => {
      const results = [createSuccessResult({ syncResult: null, dumpResult: null })];

      await adapter.notifyDailySummary(results);

      const htmlBody = mockSendMail.mock.calls[0][0].html as string;
      expect(htmlBody).toContain('N/A');
    });
  });
});
