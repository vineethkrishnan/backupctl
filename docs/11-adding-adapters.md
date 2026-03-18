# Adding Adapters

## Overview

backupctl uses hexagonal architecture (Ports & Adapters), which means adding a new database engine, notification channel, or storage backend requires **zero changes to orchestration logic**. The domain layer defines port interfaces. The application layer orchestrates through those interfaces. The infrastructure layer provides concrete adapters. To extend backupctl, you implement a port, register the adapter, and you're done.

This guide walks through adding each type of adapter with complete examples.

## Dependency Flow

```
infrastructure/ ──→ application/ ──→ domain/
```

Dependencies flow inward only:

- **Domain** — pure TypeScript interfaces and models. No framework imports, no decorators, no external dependencies.
- **Application** — orchestration services and registries. Imports from `domain/` only.
- **Infrastructure** — implements domain ports using external libraries. Imports from `domain/` and any npm packages needed.

When you add a new adapter, you work exclusively in the `infrastructure/` layer. The domain ports and application orchestration remain untouched.

## Project Structure Reference

```
src/
├── domain/backup/ports/
│   ├── database-dumper.port.ts      # Port: database dump + verify
│   ├── remote-storage.port.ts       # Port: sync, prune, snapshots
│   ├── dump-encryptor.port.ts       # Port: GPG encryption
│   ├── local-cleanup.port.ts        # Port: file cleanup
│   ├── hook-executor.port.ts        # Port: shell hook execution
│   └── backup-lock.port.ts          # Port: file-based locking
├── domain/notification/ports/
│   └── notifier.port.ts             # Port: notification channels
├── application/backup/registries/
│   ├── dumper.registry.ts           # Maps db type → DatabaseDumperPort
│   └── notifier.registry.ts         # Maps notification type → NotifierPort
├── infrastructure/adapters/
│   ├── dumpers/                     # PostgreSQL, MySQL, MongoDB adapters
│   ├── storage/                     # Restic adapter + factory
│   ├── notifiers/                   # Slack, Email, Webhook adapters
│   ├── encryptors/                  # GPG adapter
│   ├── cleanup/                     # File cleanup adapter
│   ├── hooks/                       # Shell hook executor
│   └── config/                      # YAML config loader
└── infrastructure/infrastructure.module.ts  # Binds adapters to port tokens
```

## Adding a New Database Dumper

This example adds SQLite support to backupctl.

### Step 1: Understand the port

The `DatabaseDumperPort` interface defines what every database dumper must implement:

```typescript
export interface DatabaseDumperPort {
  dump(
    outputDir: string,
    projectName: string,
    timestamp: string,
  ): Promise<DumpResult>;

  verify(filePath: string): Promise<boolean>;
}
```

- `dump()` — creates a compressed dump file in `outputDir` and returns a `DumpResult` with the file path, size, and duration
- `verify()` — validates the dump file is intact and parseable

Look at existing adapters in `src/infrastructure/adapters/dumpers/` to see how PostgreSQL, MySQL, and MongoDB implement this interface.

### Step 2: Create the adapter

Create `src/infrastructure/adapters/dumpers/sqlite-dump.adapter.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { DatabaseDumperPort } from '@domain/backup/ports/database-dumper.port';
import { DumpResult } from '@domain/backup/models/dump-result.model';
import { safeExecFile } from '@shared/child-process.util';
import * as path from 'path';
import * as fs from 'fs';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';

@Injectable()
export class SqliteDumpAdapter implements DatabaseDumperPort {
  constructor(private readonly dbPath: string) {}

  async dump(
    outputDir: string,
    projectName: string,
    timestamp: string,
  ): Promise<DumpResult> {
    const fileName = `${projectName}_backup_${timestamp}.sql.gz`;
    const filePath = path.join(outputDir, fileName);
    const startTime = Date.now();

    // Dump SQLite to SQL using .dump command
    const { stdout } = await safeExecFile('sqlite3', [this.dbPath, '.dump'], {
      timeout: 300_000,
    });

    // Compress the output
    const readStream = Buffer.from(stdout);
    const writeStream = fs.createWriteStream(filePath);
    const gzip = createGzip();

    await pipeline(
      Readable.from(readStream),
      gzip,
      writeStream,
    );

    const stats = fs.statSync(filePath);

    return new DumpResult(filePath, stats.size, Date.now() - startTime);
  }

  async verify(filePath: string): Promise<boolean> {
    // Decompress and check that the SQL contains expected SQLite statements
    const { stdout } = await safeExecFile('gunzip', ['-t', filePath], {
      timeout: 60_000,
    });
    return true;
  }
}
```

Key implementation rules:

- **Always use `safeExecFile`** — never `child_process.exec`. This prevents shell injection.
- **Always set timeouts** — every external command must have a timeout.
- **Always compress** — compression is always on. Each dumper uses the best method for its database type.

### Step 3: Register in the DumperRegistry

The `DumperRegistry` in the application layer maps database type strings to `DatabaseDumperPort` implementations. In `infrastructure.module.ts`, register your new adapter:

```typescript
// Register SQLite dumper
dumperRegistry.register('sqlite', sqliteDumpAdapter);
```

Now when a project config has `type: sqlite`, the orchestrator resolves the `SqliteDumpAdapter` through the registry.

### Step 4: Add config support

Projects can now use the new database type in `config/projects.yml`:

```yaml
projects:
  my-sqlite-app:
    type: sqlite
    database:
      path: /data/apps/myapp/database.sqlite
    schedule: "0 3 * * *"
    retention:
      keep_daily: 7
      keep_weekly: 4
      keep_monthly: 6
```

Update the YAML config loader in `src/infrastructure/adapters/config/` to validate the new `type: sqlite` value and its specific config fields (e.g., `database.path` instead of `database.host`/`database.port`).

### Step 5: Write tests

Create `test/unit/infrastructure/adapters/dumpers/sqlite-dump.adapter.spec.ts`:

```typescript
describe('SqliteDumpAdapter', () => {
  // Mock safeExecFile to avoid calling real sqlite3
  const mockExecFile = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('dump', () => {
    it('should call sqlite3 with .dump command', async () => {
      mockExecFile.mockResolvedValue({ stdout: 'CREATE TABLE...', stderr: '' });
      const adapter = new SqliteDumpAdapter('/path/to/db.sqlite');

      const result = await adapter.dump('/output', 'myproject', '20260318_030000');

      expect(mockExecFile).toHaveBeenCalledWith(
        'sqlite3',
        ['/path/to/db.sqlite', '.dump'],
        expect.objectContaining({ timeout: 300_000 }),
      );
      expect(result.filePath).toContain('myproject_backup_20260318_030000.sql.gz');
    });

    it('should set a timeout on the dump command', async () => {
      mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });
      const adapter = new SqliteDumpAdapter('/path/to/db.sqlite');

      await adapter.dump('/output', 'myproject', '20260318_030000');

      expect(mockExecFile).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ timeout: expect.any(Number) }),
      );
    });
  });

  describe('verify', () => {
    it('should verify the gzip integrity', async () => {
      mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });
      const adapter = new SqliteDumpAdapter('/path/to/db.sqlite');

      const result = await adapter.verify('/output/myproject_backup.sql.gz');

      expect(result).toBe(true);
    });
  });
});
```

Testing strategy for dumper adapters:

- Mock `safeExecFile` to avoid calling real database CLI tools
- Mock `fs` for file system operations
- Verify the correct command and arguments are passed
- Verify timeouts are set
- Test error handling for command failures

## Adding a New Notifier

This example adds Telegram support to backupctl.

### Step 1: Understand the port

The `NotifierPort` interface:

```typescript
export interface NotifierPort {
  notifyStarted(projectName: string): Promise<void>;
  notifySuccess(result: BackupResult): Promise<void>;
  notifyFailure(projectName: string, error: BackupStageError): Promise<void>;
  notifyWarning(projectName: string, message: string): Promise<void>;
  notifyDailySummary(results: BackupResult[]): Promise<void>;
}
```

Every notification channel must implement all five methods. Look at the existing Slack, Email, and Webhook adapters for patterns.

### Step 2: Create the adapter

Create `src/infrastructure/adapters/notifiers/telegram-notifier.adapter.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { NotifierPort } from '@domain/notification/ports/notifier.port';
import { BackupResult } from '@domain/backup/models/backup-result.model';
import { BackupStageError } from '@domain/backup/models/backup-stage-error.model';
import axios from 'axios';

@Injectable()
export class TelegramNotifierAdapter implements NotifierPort {
  constructor(
    private readonly botToken: string,
    private readonly chatId: string,
  ) {}

  async notifyStarted(projectName: string): Promise<void> {
    await this.send(`🔄 Backup started: *${projectName}*`);
  }

  async notifySuccess(result: BackupResult): Promise<void> {
    await this.send(
      `✅ Backup completed: *${result.projectName}*\n` +
      `Duration: ${result.formattedDuration}\n` +
      `Size: ${result.formattedSize}`,
    );
  }

  async notifyFailure(projectName: string, error: BackupStageError): Promise<void> {
    await this.send(
      `❌ Backup failed: *${projectName}*\n` +
      `Stage: ${error.stage}\n` +
      `Error: ${error.message}`,
    );
  }

  async notifyWarning(projectName: string, message: string): Promise<void> {
    await this.send(`⚠️ Warning for *${projectName}*: ${message}`);
  }

  async notifyDailySummary(results: BackupResult[]): Promise<void> {
    const succeeded = results.filter(r => r.isSuccess).length;
    const failed = results.length - succeeded;
    await this.send(
      `📊 Daily backup summary\n` +
      `Succeeded: ${succeeded}\n` +
      `Failed: ${failed}`,
    );
  }

  private async send(text: string): Promise<void> {
    await axios.post(
      `https://api.telegram.org/bot${this.botToken}/sendMessage`,
      {
        chat_id: this.chatId,
        text,
        parse_mode: 'Markdown',
      },
      { timeout: 10_000 },
    );
  }
}
```

Key implementation rules:

- **Set timeouts** on all HTTP calls
- **Implement all five methods** — the port interface is the contract
- **Use `notifyWarning`** for non-critical issues like timeouts or missing assets

### Step 3: Register in the NotifierRegistry

In `infrastructure.module.ts`:

```typescript
notifierRegistry.register('telegram', telegramNotifierAdapter);
```

### Step 4: Add config support

Update the YAML config loader to accept `notification.type: telegram`:

```yaml
projects:
  myproject:
    type: postgres
    # ...
    notification:
      type: telegram
      bot_token: ${TELEGRAM_BOT_TOKEN}
      chat_id: ${TELEGRAM_CHAT_ID}
```

Add the corresponding environment variables to `.env`:

```bash
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
TELEGRAM_CHAT_ID=-1001234567890
```

### Step 5: Write tests

Create `test/unit/infrastructure/adapters/notifiers/telegram-notifier.adapter.spec.ts`:

```typescript
describe('TelegramNotifierAdapter', () => {
  const mockAxiosPost = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();
    axios.post = mockAxiosPost;
    mockAxiosPost.mockResolvedValue({ data: { ok: true } });
  });

  it('should send a started notification', async () => {
    const adapter = new TelegramNotifierAdapter('bot-token', 'chat-id');

    await adapter.notifyStarted('myproject');

    expect(mockAxiosPost).toHaveBeenCalledWith(
      'https://api.telegram.org/botbot-token/sendMessage',
      expect.objectContaining({
        chat_id: 'chat-id',
        text: expect.stringContaining('myproject'),
      }),
      expect.objectContaining({ timeout: 10_000 }),
    );
  });

  // ... tests for notifySuccess, notifyFailure, notifyWarning, notifyDailySummary
});
```

## Adding a New Storage Backend

This example outlines adding S3 support.

### Step 1: Understand the port

The `RemoteStoragePort` interface:

```typescript
export interface RemoteStoragePort {
  sync(paths: string[], options: SyncOptions): Promise<SyncResult>;
  prune(retentionPolicy: RetentionPolicy): Promise<PruneResult>;
  snapshots(options?: SnapshotQueryOptions): Promise<Snapshot[]>;
  restore(snapshotId: string, targetPath: string, options?: RestoreOptions): Promise<void>;
  check(): Promise<HealthCheckResult>;
  unlock(): Promise<void>;
  stats(): Promise<RepoStats>;
}
```

The storage port is more complex than dumpers or notifiers — it handles the full lifecycle of remote snapshot management.

### Step 2: Create the adapter

Create `src/infrastructure/adapters/storage/s3-storage.adapter.ts`. This adapter would use the AWS SDK (or a compatible client) instead of restic SFTP:

```typescript
import { Injectable } from '@nestjs/common';
import { RemoteStoragePort } from '@domain/backup/ports/remote-storage.port';

@Injectable()
export class S3StorageAdapter implements RemoteStoragePort {
  constructor(
    private readonly bucket: string,
    private readonly region: string,
    private readonly credentials: S3Credentials,
  ) {}

  async sync(paths: string[], options: SyncOptions): Promise<SyncResult> {
    // Upload files to S3 with tagging
  }

  async prune(retentionPolicy: RetentionPolicy): Promise<PruneResult> {
    // Apply lifecycle rules or manual cleanup
  }

  async snapshots(options?: SnapshotQueryOptions): Promise<Snapshot[]> {
    // List versioned objects or prefix-based snapshots
  }

  async restore(snapshotId: string, targetPath: string, options?: RestoreOptions): Promise<void> {
    // Download from S3 to local path
  }

  async check(): Promise<HealthCheckResult> {
    // Verify bucket access and connectivity
  }

  async unlock(): Promise<void> {
    // No-op for S3 (no lock concept)
  }

  async stats(): Promise<RepoStats> {
    // Calculate bucket size and object counts
  }
}
```

### Step 3: Create a factory (if needed)

If the adapter requires per-project configuration (like the restic adapter does), create a factory that builds adapter instances from project config:

```typescript
@Injectable()
export class S3StorageFactory {
  create(projectConfig: ProjectConfig): S3StorageAdapter {
    return new S3StorageAdapter(
      projectConfig.storage.bucket,
      projectConfig.storage.region,
      projectConfig.storage.credentials,
    );
  }
}
```

### Step 4: Register in the infrastructure module

Bind the adapter (or factory) to the `RemoteStoragePort` token in `infrastructure.module.ts`.

### Step 5: Write tests

Mock the AWS SDK client and test each method independently. Verify credentials are passed correctly, error handling works, and timeouts are respected.

## Testing Your Adapter

### Mock strategy by adapter type

| Adapter type | What to mock |
|---|---|
| Database dumpers | `safeExecFile` (child process), `fs` (file system) |
| Notifiers (HTTP) | `axios` |
| Notifiers (email) | `nodemailer` transport |
| Storage backends | `safeExecFile` for CLI-based, SDK client for API-based |
| Encryptors | `safeExecFile` (GPG commands) |

### Test file location

Tests mirror the `src/` directory structure:

```
src/infrastructure/adapters/dumpers/sqlite-dump.adapter.ts
→ test/unit/infrastructure/adapters/dumpers/sqlite-dump.adapter.spec.ts

src/infrastructure/adapters/notifiers/telegram-notifier.adapter.ts
→ test/unit/infrastructure/adapters/notifiers/telegram-notifier.adapter.spec.ts
```

### What to test

- **Command construction** — verify the correct CLI tool, arguments, and flags are passed
- **Output parsing** — verify adapter correctly parses stdout/stderr from external commands
- **Timeout enforcement** — verify all external calls have timeouts
- **Error handling** — verify adapter wraps errors appropriately
- **Config mapping** — verify project config values are correctly mapped to adapter behavior

## Checklist for New Adapters

Before considering your adapter complete:

- [ ] Implements the full port interface (all methods)
- [ ] Uses `safeExecFile` for external commands (never `child_process.exec`)
- [ ] Sets timeouts on all external calls (HTTP, shell, SDK)
- [ ] Handles errors gracefully — wraps external errors with context
- [ ] Has comprehensive unit tests with mocked externals
- [ ] Registered in the appropriate registry (`DumperRegistry` / `NotifierRegistry`) or infrastructure module
- [ ] Config support added to the YAML loader and validated
- [ ] Environment variable placeholders documented (for secrets)
- [ ] Works with `--dry-run` (adapter is resolved but not executed)
- [ ] Documented in this guide with a brief summary

## What's Next

- **Architecture deep dive** — [Architecture](02-architecture.md) explains the hexagonal layer structure, port/adapter pattern, and design decisions in detail.
- **How adapters are used** — [Backup Flow](08-backup-flow.md) shows the 11-step orchestration pipeline and where each adapter is called.
- **Quick commands** — [Cheatsheet](10-cheatsheet.md) for testing your adapter end-to-end.
