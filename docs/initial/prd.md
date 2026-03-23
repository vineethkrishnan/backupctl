# PRD: backupctl

**Version:** 1.1
**Date:** March 18, 2026
**Author:** Vineeth N K
**Status:** Final

---

## 1. Overview

`backupctl` is a standalone, generic, database-agnostic backup service built with NestJS 11 following hexagonal architecture. It runs as an independent Docker container, manages scheduled backups for multiple projects via YAML configuration, syncs to Hetzner storage box via restic, and provides a full CLI for deployment, health checks, restore, restic passthrough, and management.

`backupctl` is not tied to any specific project, database engine, or notification provider. Everything is configurable via YAML + `.env`.

---

## 2. Goals

- **Generic:** Supports any database (PostgreSQL, MySQL, MongoDB) and any notification channel (Slack, Email, Webhook) via adapter pattern.
- **Multi-project:** Single service instance backs up multiple projects, each with its own schedule, DB, assets, retention, and notification config.
- **Hexagonal architecture:** Domain logic has zero infra dependencies. All external concerns (DB dumping, storage sync, notifications) are ports with swappable adapters.
- **TDD:** Full test coverage with Jest. Domain logic and adapters tested independently.
- **CLI-first management:** All operations via nest-commander CLI, including restic passthrough per project.
- **Production-ready:** Dump encryption, pre/post hooks, backup verification, configurable retries, audit trail.

---

## 3. Non-Goals (v1)

- Web-based dashboard or UI
- Multi-node / distributed backup coordination
- Streaming / WAL-based continuous backup (point-in-time recovery)
- Backup of non-filesystem assets (e.g., S3 buckets)
- Multiple notification channels per project (single channel only)
- Automatic database import on restore (extract files only; user runs pg_restore/mysql manually)

---

## 4. Architecture

### 4.1 Hexagonal Layout (Domain / Application / Infrastructure)

```
backupctl/
├── src/
│   ├── domain/                              # Pure TypeScript — ZERO framework imports
│   │   ├── backup/                          # Core backup domain
│   │   │   ├── ports/
│   │   │   │   ├── database-dumper.port.ts
│   │   │   │   ├── remote-storage.port.ts
│   │   │   │   ├── dump-encryptor.port.ts
│   │   │   │   ├── local-cleanup.port.ts
│   │   │   │   ├── hook-executor.port.ts
│   │   │   │   └── backup-lock.port.ts
│   │   │   ├── models/
│   │   │   │   ├── backup-result.model.ts
│   │   │   │   ├── backup-stage-error.ts
│   │   │   │   ├── backup-status.enum.ts
│   │   │   │   ├── backup-stage.enum.ts
│   │   │   │   ├── dump-result.model.ts
│   │   │   │   ├── sync-result.model.ts
│   │   │   │   ├── prune-result.model.ts
│   │   │   │   ├── cleanup-result.model.ts
│   │   │   │   ├── snapshot-info.model.ts
│   │   │   │   └── cache-info.model.ts
│   │   │   └── policies/
│   │   │       └── retry.policy.ts
│   │   ├── audit/                           # Audit & resilience domain
│   │   │   ├── ports/
│   │   │   │   ├── audit-log.port.ts
│   │   │   │   └── fallback-writer.port.ts
│   │   │   └── models/
│   │   │       └── health-check-result.model.ts
│   │   ├── config/                          # Configuration domain
│   │   │   ├── ports/
│   │   │   │   └── config-loader.port.ts
│   │   │   └── models/
│   │   │       ├── project-config.model.ts
│   │   │       └── retention-policy.model.ts
│   │   ├── notification/                    # Notification domain
│   │   │   └── ports/
│   │   │       └── notifier.port.ts
│   │   └── shared/                          # Cross-domain
│   │       └── ports/
│   │           └── clock.port.ts
│   │
│   ├── application/                         # Use case orchestration — imports domain/ only
│   │   ├── backup/
│   │   │   ├── backup-orchestrator.service.ts
│   │   │   ├── cache-management.service.ts
│   │   │   └── registries/
│   │   │       ├── dumper.registry.ts
│   │   │       └── notifier.registry.ts
│   │   ├── audit/
│   │   │   ├── audit-query.service.ts
│   │   │   └── startup-recovery.service.ts
│   │   ├── health/
│   │   │   └── health-check.service.ts
│   │   ├── snapshot/
│   │   │   └── snapshot-management.service.ts
│   │   └── application.module.ts
│   │
│   ├── infrastructure/                      # ALL external-facing code
│   │   ├── adapters/                        # Driven (outbound) — implements domain ports
│   │   │   ├── dumpers/
│   │   │   │   ├── postgres-dump.adapter.ts
│   │   │   │   ├── mysql-dump.adapter.ts
│   │   │   │   └── mongo-dump.adapter.ts
│   │   │   ├── storage/
│   │   │   │   ├── restic-storage.adapter.ts
│   │   │   │   └── restic-storage.factory.ts
│   │   │   ├── encryptors/
│   │   │   │   ├── gpg-encryptor.adapter.ts
│   │   │   │   └── gpg-key-manager.ts
│   │   │   ├── cleanup/
│   │   │   │   └── file-cleanup.adapter.ts
│   │   │   ├── hooks/
│   │   │   │   └── shell-hook-executor.adapter.ts
│   │   │   ├── notifiers/
│   │   │   │   ├── slack-notifier.adapter.ts
│   │   │   │   ├── email-notifier.adapter.ts
│   │   │   │   └── webhook-notifier.adapter.ts
│   │   │   ├── config/
│   │   │   │   └── yaml-config-loader.adapter.ts
│   │   │   └── clock/
│   │   │       └── system-clock.adapter.ts
│   │   ├── persistence/                     # Driven (outbound) — data storage
│   │   │   ├── audit/
│   │   │   │   ├── entities/
│   │   │   │   │   └── backup-log.entity.ts
│   │   │   │   ├── migrations/
│   │   │   │   ├── typeorm-audit-log.adapter.ts
│   │   │   │   └── data-source.ts
│   │   │   ├── fallback/
│   │   │   │   └── jsonl-fallback-writer.adapter.ts
│   │   │   └── lock/
│   │   │       └── file-backup-lock.adapter.ts
│   │   ├── cli/                             # Driving (inbound) — CLI commands
│   │   │   ├── commands/
│   │   │   │   ├── run.command.ts
│   │   │   │   ├── status.command.ts
│   │   │   │   ├── health.command.ts
│   │   │   │   ├── restore.command.ts
│   │   │   │   ├── snapshots.command.ts
│   │   │   │   ├── prune.command.ts
│   │   │   │   ├── logs.command.ts
│   │   │   │   ├── config.command.ts
│   │   │   │   ├── cache.command.ts
│   │   │   │   └── restic.command.ts
│   │   │   └── cli.module.ts
│   │   ├── http/                            # Driving (inbound) — HTTP controllers
│   │   │   ├── health.controller.ts
│   │   │   └── status.controller.ts
│   │   ├── scheduler/                       # Driving (inbound) — cron
│   │   │   └── dynamic-scheduler.service.ts
│   │   └── infrastructure.module.ts
│   │
│   ├── shared/                              # Cross-cutting: DI tokens, utilities
│   │   ├── injection-tokens.ts
│   │   ├── child-process.util.ts
│   │   └── format.util.ts
│   │
│   ├── app.module.ts
│   ├── main.ts                              # HTTP entry point
│   └── cli.ts                               # CLI entry point
│
├── config/
│   └── projects.yml
├── scripts/
│   ├── deploy.sh                            # Host-side only
│   └── backupctl-manage.sh                  # Host-side only
├── docs/
├── test/
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── package.json
├── tsconfig.json
└── jest.config.ts
```

### 4.2 Dependency Flow

```
infrastructure/ ──→ application/ ──→ domain/
```

- `domain/` imports **nothing** outside itself. No `@nestjs/*`, no `typeorm`, no decorators. Pure TypeScript.
- `application/` imports only `domain/`. Contains use case orchestration and registries.
- `infrastructure/` imports `domain/` (to implement ports) + external libs. Binds adapters to port tokens via NestJS DI.
- `shared/` imported by any layer. Only pure utilities and DI token definitions.

### 4.3 Layer Responsibilities

| Layer | Responsibility |
|-------|---------------|
| **Domain** | Pure interfaces (ports), immutable value objects (models), pure functions (policies). Zero framework dependencies. Organized by subdomain: `backup/`, `audit/`, `config/`, `notification/`, `shared/`. |
| **Application** | Use case implementations. `BackupOrchestratorService` coordinates ports in sequence. Registries resolve adapters dynamically. `StartupRecoveryService` handles crash recovery on boot. |
| **Infrastructure / Adapters** | Concrete implementations of driven (outbound) ports: database dumpers, restic storage, notifiers, GPG encryptor, hooks, config loader, clock. |
| **Infrastructure / Persistence** | Data storage: TypeORM audit log with migrations, JSONL fallback file writer, file-based backup lock. |
| **Infrastructure / CLI** | nest-commander commands — driving (inbound) adapter for all 14 CLI commands. |
| **Infrastructure / HTTP** | Minimal internal-only endpoints for container orchestration (health, status). |
| **Infrastructure / Scheduler** | Dynamic cron registration per project, uses backup lock for concurrency. |

---

## 5. Configuration

### 5.1 Global `.env`

```env
# App
APP_PORT=3100
TIMEZONE=Europe/Berlin
BACKUP_BASE_DIR=/data/backups

# Audit DB
AUDIT_DB_HOST=backupctl-audit-db
AUDIT_DB_PORT=5432
AUDIT_DB_NAME=backup_audit
AUDIT_DB_USER=audit_user
AUDIT_DB_PASSWORD=audit_secret

# Hetzner Storage Box (shared)
HETZNER_SSH_HOST=u123456.your-storagebox.de
HETZNER_SSH_USER=u123456
HETZNER_SSH_KEY_PATH=/root/.ssh/id_rsa

# Restic (global defaults, overridable per project)
RESTIC_PASSWORD=default-restic-repo-password

# Global fallback notification
NOTIFICATION_TYPE=slack
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/DEFAULT/WEBHOOK/URL

# Retry (global only)
BACKUP_RETRY_COUNT=3
BACKUP_RETRY_DELAY_MS=5000

# Encryption (global default, overridable per project)
ENCRYPTION_ENABLED=false
ENCRYPTION_TYPE=gpg
GPG_RECIPIENT=backup@company.com

# Daily summary cron
DAILY_SUMMARY_CRON=0 8 * * *

# Health check
HEALTH_DISK_MIN_FREE_GB=5

# Logging
LOG_LEVEL=info
LOG_DIR=/data/backups/.logs
LOG_MAX_SIZE=10m
LOG_MAX_FILES=5

# GPG keys directory (auto-imported on startup)
GPG_KEYS_DIR=/app/gpg-keys

# Project DB passwords (referenced in projects.yml via ${})
VINSWARE_DB_PASSWORD=secret
VINSWARE_RESTIC_PASSWORD=restic-secret
PROJECTX_DB_PASSWORD=secret
PROJECTY_DB_PASSWORD=secret
EMAIL_PASSWORD=smtp-secret
```

### 5.2 Project YAML (`config/projects.yml`)

```yaml
projects:
  - name: vinsware
    enabled: true
    cron: "0 0 * * *"
    timeout_minutes: 30

    database:
      type: postgres
      host: postgres-vinsware
      port: 5432
      name: vinsware_db
      user: backup_user
      password: ${VINSWARE_DB_PASSWORD}

    compression:
      enabled: true              # per-project override (default: true)

    assets:
      paths:
        - /data/vinsware/uploads
        - /data/vinsware/assets

    restic:
      repository_path: /backups/vinsware
      password: ${VINSWARE_RESTIC_PASSWORD}
      snapshot_mode: combined

    retention:
      local_days: 7
      keep_daily: 7
      keep_weekly: 4
      keep_monthly: 0

    encryption:
      enabled: true
      type: gpg
      recipient: vinsware-backup@company.com

    hooks:
      pre_backup: "curl -s http://vinsware-app:3000/maintenance/on"
      post_backup: "curl -s http://vinsware-app:3000/maintenance/off"

    verification:
      enabled: true

    notification:
      type: slack
      config:
        webhook_url: https://hooks.slack.com/services/VINSWARE/SPECIFIC/HOOK

  - name: project-x
    enabled: true
    cron: "30 1 * * *"

    database:
      type: mysql
      host: mysql-projectx
      port: 3306
      name: projectx_db
      user: backup_user
      password: ${PROJECTX_DB_PASSWORD}

    assets:
      paths:
        - /data/projectx/storage

    restic:
      repository_path: /backups/project-x
      snapshot_mode: separate

    retention:
      local_days: 14
      keep_daily: 14
      keep_weekly: 8

    notification:
      type: email
      config:
        smtp_host: smtp.gmail.com
        smtp_port: 587
        smtp_secure: true
        to: devops@company.com
        from: backup@company.com
        password: ${EMAIL_PASSWORD}

  - name: project-y
    enabled: true
    cron: "0 2 * * *"

    database:
      type: postgres
      host: postgres-projecty
      port: 5432
      name: projecty_db
      user: backup_user
      password: ${PROJECTY_DB_PASSWORD}

    assets:
      paths: []

    restic:
      repository_path: /backups/project-y
      snapshot_mode: combined

    retention:
      local_days: 7
      keep_daily: 7
      keep_weekly: 4

    # No notification block → uses global .env fallback
```

### 5.3 Config Resolution Rules

1. Project-level YAML values take priority.
2. If a field is missing in YAML, fall back to `.env` global default.
3. `${VAR_NAME}` in YAML is resolved from `.env` at load time.
4. Secrets (passwords) must always be in `.env`, referenced via `${}` in YAML.
5. If `notification` block is absent in a project, the global `NOTIFICATION_TYPE` + config from `.env` is used.
6. If `encryption` block is absent, global `ENCRYPTION_ENABLED` / `ENCRYPTION_TYPE` / `GPG_RECIPIENT` from `.env` is used.
7. If `restic.password` is absent, global `RESTIC_PASSWORD` from `.env` is used.
8. `compression.enabled` defaults to `true` if absent (always compress). Per-project override only needed to disable.
9. `timeout_minutes` is optional. If absent, no timeout alerting for that project.
10. Config changes require explicit `backupctl config reload` — no hot-reload or file watching.
11. `BACKUP_BASE_DIR` configurable (default `/data/backups`). Per-project subdirs auto-created.
12. All timestamps use `TIMEZONE` env var (default `Europe/Berlin`). Stored in audit DB as timezone-aware.

### 5.4 Backup Directory Structure

```
${BACKUP_BASE_DIR}/                        # default: /data/backups
├── vinsware/
│   ├── vinsware_backup_20260318_000000_a1b2.sql.gz
│   ├── vinsware_backup_20260317_000000_c3d4.sql.gz
│   └── .lock                              # file-based lock (present while backup running)
├── project-x/
│   └── ...
├── .fallback-audit/
│   └── fallback.jsonl                     # JSONL fallback for audit/notification failures
└── .logs/
    ├── backupctl-2026-03-18.log           # winston daily rotate
    └── backupctl-2026-03-17.log
```

---

## 6. Domain Ports (Interfaces)

All ports are pure TypeScript interfaces with zero framework imports. Organized by subdomain.

### 6.1 Backup Domain — `domain/backup/ports/`

#### DatabaseDumperPort

```typescript
// Compression always enabled — adapters use best method per DB type:
// pg_dump → --format=custom, mysqldump → pipe gzip, mongodump → --gzip

export interface DumpResult {
  filePath: string;
  sizeBytes: number;
  durationMs: number;
}

export interface DatabaseDumperPort {
  dump(outputDir: string, projectName: string, timestamp: string): Promise<DumpResult>;
  verify(filePath: string): Promise<boolean>;
}
```

#### RemoteStoragePort

```typescript
export interface SyncOptions {
  tags: string[];                              // e.g. ['backupctl:db', 'project:vinsware']
  snapshotMode: 'combined' | 'separate';
}

export interface SyncResult {
  snapshotId: string;
  filesNew: number;
  filesChanged: number;
  bytesAdded: number;
  durationMs: number;
}

export interface PruneResult {
  snapshotsRemoved: number;
  spaceFreed: string;
}

export interface SnapshotInfo {
  id: string;
  time: string;
  paths: string[];
  hostname: string;
  tags: string[];
  size: string;
}

export interface CacheInfo {
  projectName: string;
  cacheSizeBytes: number;
  cachePath: string;
}

export interface RemoteStoragePort {
  sync(paths: string[], options: SyncOptions): Promise<SyncResult>;
  prune(retention: RetentionPolicy): Promise<PruneResult>;
  listSnapshots(): Promise<SnapshotInfo[]>;
  restore(snapshotId: string, targetPath: string, includePaths?: string[]): Promise<void>;
  exec(args: string[]): Promise<string>;
  getCacheInfo(): Promise<CacheInfo>;
  clearCache(): Promise<void>;
  unlock(): Promise<void>;
}
```

#### DumpEncryptorPort

```typescript
export interface DumpEncryptorPort {
  encrypt(filePath: string): Promise<string>;  // returns encrypted file path
  decrypt(filePath: string): Promise<string>;  // returns decrypted file path
}
```

#### LocalCleanupPort

```typescript
export interface CleanupResult {
  filesRemoved: number;
  spaceFreed: number;
}

export interface LocalCleanupPort {
  cleanup(directory: string, retentionDays: number): Promise<CleanupResult>;
}
```

#### HookExecutorPort

```typescript
export interface HookExecutorPort {
  execute(command: string): Promise<void>;
}
```

#### BackupLockPort

```typescript
// File-based lock ({BACKUP_BASE_DIR}/{project}/.lock)
// Cleaned on startup by StartupRecoveryService

export interface BackupLockPort {
  acquire(projectName: string): Promise<boolean>;       // false if already locked (CLI rejection)
  acquireOrQueue(projectName: string): Promise<void>;   // waits until lock available (cron queuing)
  release(projectName: string): Promise<void>;
  isLocked(projectName: string): boolean;
}
```

### 6.2 Audit Domain — `domain/audit/ports/`

#### AuditLogPort

```typescript
// Insert + update pattern: startRun → trackProgress → finishRun
// Orphaned startRun records (no finishRun) detected during crash recovery

export interface AuditLogPort {
  startRun(projectName: string): Promise<string>;                          // returns generated runId (UUID)
  trackProgress(runId: string, stage: BackupStage): Promise<void>;         // updates current_stage
  finishRun(runId: string, result: BackupResult): Promise<void>;           // updates status, completed_at, all fields
  findByProject(projectName: string, limit?: number): Promise<BackupResult[]>;
  findFailed(projectName: string, limit?: number): Promise<BackupResult[]>;
  findSince(since: Date): Promise<BackupResult[]>;
  findOrphaned(): Promise<BackupResult[]>;                                 // status='started', completed_at IS NULL
}
```

#### FallbackWriterPort

```typescript
// JSONL format at {BACKUP_BASE_DIR}/.fallback-audit/fallback.jsonl
// Append-only, replayed on startup by StartupRecoveryService

export interface FallbackEntry {
  id: string;
  type: 'audit' | 'notification';
  payload: unknown;
  timestamp: string;
}

export interface FallbackWriterPort {
  writeAuditFallback(result: BackupResult): Promise<void>;
  writeNotificationFallback(notificationType: string, payload: unknown): Promise<void>;
  readPendingEntries(): Promise<FallbackEntry[]>;
  clearReplayed(ids: string[]): Promise<void>;
}
```

### 6.3 Config Domain — `domain/config/ports/`

#### ConfigLoaderPort

```typescript
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface ConfigLoaderPort {
  loadAll(): ProjectConfig[];
  getProject(name: string): ProjectConfig;
  validate(): ValidationResult;
  reload(): void;                              // re-reads YAML, re-resolves ${} vars
}
```

### 6.4 Notification Domain — `domain/notification/ports/`

#### NotifierPort

```typescript
export interface NotifierPort {
  notifyStarted(projectName: string): Promise<void>;
  notifySuccess(result: BackupResult): Promise<void>;
  notifyFailure(projectName: string, error: BackupStageError): Promise<void>;
  notifyWarning(projectName: string, message: string): Promise<void>;      // timeout, missing assets, etc.
  notifyDailySummary(results: BackupResult[]): Promise<void>;
}
```

### 6.5 Shared — `domain/shared/ports/`

#### ClockPort

```typescript
export interface ClockPort {
  now(): Date;
  timestamp(): string;   // formatted for file names: YYYYMMDD_HHmmss (in configured TIMEZONE)
}
```

---

## 7. Execution Flow

Per-project backup execution (triggered by cron or CLI):

```
 1. [Notify]     → notifier.notifyStarted(projectName)
 2. [Pre-hook]   → execute pre_backup shell command (if configured)
 3. [Dump]       → dumper.dump() → /data/backups/{project}/{project}_backup_{YYYYMMDD_HHmmss}_{uuid-short}.sql.gz
 4. [Verify]     → dumper.verify() (if verification.enabled)
 5. [Encrypt]    → encryptor.encrypt() (if encryption.enabled)
 6. [Sync]       → storage.sync() based on snapshot_mode:
                    - combined: single restic backup [dump_dir, ...asset_paths] tagged `backupctl:combined`
                    - separate: restic backup dump_dir tagged `backupctl:db`, then each asset tagged `backupctl:assets:{path}`
                    - missing asset paths are skipped with a warning (not fatal)
 7. [Prune]      → storage.prune() per retention config
 8. [Cleanup]    → cleanup.cleanup() remove local dumps older than retention.local_days
 9. [Post-hook]  → execute post_backup shell command (if configured)
10. [Audit]      → save BackupLog to audit DB
11. [Notify]     → notifier.notifySuccess(result) or notifier.notifyFailure(error)
```

**Retry logic:** If any step (3-8) fails, retry up to `BACKUP_RETRY_COUNT` times with `BACKUP_RETRY_DELAY_MS` exponential backoff. On final failure, skip to step 10-11 with error.

**Daily summary:** A separate cron (configurable via `DAILY_SUMMARY_CRON`, default 08:00) sends `notifyDailySummary()` with all project results from the last 24 hours.

### 7.1 Concurrency Model

A per-project lock prevents concurrent backups for the same project:

- **Cron overlap:** If a cron-triggered backup is still running when the next cron fires for the same project, the new run is **queued** and executes after the current one completes.
- **CLI collision:** If a user runs `backupctl run vinsware` while a backup is already in progress, the CLI **rejects with an error**: "Backup already in progress for vinsware".
- **`run --all`:** Runs projects **sequentially** in YAML order. If one project fails, the remaining projects still execute.

### 7.2 Failure Recovery

#### Audit DB unavailable

If audit DB is unreachable at step 10, the backup result is written to a **local fallback file** (`/data/backups/.fallback-audit/`). On next startup (or when audit DB reconnects), the service replays all pending fallback entries into the audit DB. The backup is still considered **successful** — the audit write is retried, not the backup.

#### Notification failure

If notification fails (Slack 500, SMTP timeout) at step 1 or 11, the failure is logged to the **same local fallback file**. The service retries pending notifications on next startup. The backup status in audit is still success/failure based on the actual backup outcome, not the notification.

#### Crash recovery on startup

On service startup, the following recovery steps execute:

1. **Orphaned backups:** Query audit DB for records with `status = 'started'` and `completed_at IS NULL`. Mark them as `failed` with `error_stage = 'crash_recovery'`.
2. **Orphaned dump files:** Scan `/data/backups/*/` for dump files not associated with a `success` audit record. Clean them up.
3. **Restic repo unlock:** For all enabled projects, check if the restic repo is locked and **auto-unlock**. Safe because no backups are running during startup.
4. **Fallback audit replay:** Replay any pending entries from the local fallback file into the audit DB.
5. **Fallback notification replay:** Retry any pending notifications from the fallback file.
6. **GPG key import:** Auto-import all `.gpg` public key files from the mounted `./gpg-keys/` directory into the container's GPG keyring.

### 7.3 Snapshot Tagging

Restic snapshots are tagged for identification:

- **`snapshot_mode: combined`:** Single snapshot tagged `backupctl:combined,project:{name}`
- **`snapshot_mode: separate`:** DB dump snapshot tagged `backupctl:db,project:{name}`, each asset snapshot tagged `backupctl:assets:{path},project:{name}`

Tags enable filtering in `backupctl snapshots` and selective restore with `--only db` / `--only assets`.

### 7.4 Dry Run Mode

`backupctl run <project> --dry-run` simulates the backup without executing any destructive steps:

1. Loads and validates project config
2. Resolves the correct dumper and notifier adapters
3. Checks DB connectivity (test connection, no dump)
4. Checks restic repo accessibility (`restic snapshots` — read-only)
5. Checks SSH connectivity to Hetzner storage box
6. Checks disk space against `HEALTH_DISK_MIN_FREE_GB`
7. Validates GPG key availability (if encryption enabled)
8. Reports results — all checks pass or lists failures

No data is dumped, synced, or modified. Useful for validating config changes before a real run.

### 7.5 Restore Guidance

After `backupctl restore` extracts files, two additional flags help with the next step:

- **`--decompress`:** Automatically decompresses the dump file. For pg_dump custom format: extracts to SQL. For gzipped dumps: runs `gunzip`. The decompressed file is placed alongside the original.
- **`--guide`:** Prints step-by-step import instructions tailored to the project's database type:
  - PostgreSQL: `pg_restore --dbname=... --clean --if-exists <file>`
  - MySQL: `mysql -u ... -p ... < <file>`
  - MongoDB: `mongorestore --gzip --archive=<file> --db=...`

Both flags can be combined: `backupctl restore vinsware latest /data/restore/ --decompress --guide`

### 7.6 Restic Cache Management

Restic maintains a local cache per repository in `~/.cache/restic/`. Over time this can consume significant disk space.

- `backupctl cache <project>` — shows cache size for the project's restic repo
- `backupctl cache <project> --clear` — runs `restic cache --cleanup` for the project
- `backupctl cache --clear-all` — clears cache for all enabled projects

### 7.7 Timeout Alerting

Each project can optionally configure `timeout_minutes` in YAML. If a backup exceeds this duration, a **warning notification** is sent (the backup is NOT killed — it continues running). This helps detect stuck backups or unexpected performance degradation.

---

## 8. CLI Commands

All commands via nest-commander. Entry point: `cli.ts`.

Usage: `backupctl <command> [options]`

When running inside Docker: `docker exec backupctl node dist/cli.js <command> [options]`

### 8.1 Command Reference

| Command | Description |
|---------|-------------|
| `backupctl run <project>` | Trigger immediate backup for a project |
| `backupctl run --all` | Trigger backup for all enabled projects (sequential) |
| `backupctl status` | Show last backup status for all projects |
| `backupctl status <project>` | Show detailed backup history for a project |
| `backupctl status <project> --last <n>` | Show last N backup entries |
| `backupctl health` | Health check: audit DB, restic repos, disk space, SSH |
| `backupctl restore <project> <snapshot-id> <target-path>` | Restore a snapshot to target path (files only) |
| `backupctl restore <project> latest <target-path>` | Restore latest snapshot |
| `backupctl restore <project> <snapshot-id> <target-path> --only db` | Restore only DB dump from combined snapshot |
| `backupctl restore <project> <snapshot-id> <target-path> --only assets` | Restore only assets from combined snapshot |
| `backupctl snapshots <project>` | List all restic snapshots for a project (with tags) |
| `backupctl snapshots <project> --last <n>` | List last N snapshots |
| `backupctl prune <project>` | Manually trigger restic prune for a project |
| `backupctl prune --all` | Prune all projects |
| `backupctl logs <project>` | Show backup logs from audit DB |
| `backupctl logs <project> --last <n>` | Show last N log entries |
| `backupctl logs <project> --failed` | Show only failed backups |
| `backupctl config validate` | Validate YAML config and .env completeness |
| `backupctl config show <project>` | Show resolved config for a project (secrets masked) |
| `backupctl config reload` | Reload YAML config and re-register cron schedules |
| `backupctl config import-gpg-key <file>` | Import a GPG public key into the keyring |
| `backupctl restic <project> <restic-command> [args...]` | Passthrough any restic command for a project |

| `backupctl run <project> --dry-run` | Simulate backup without executing (validates config, checks connectivity) |
| `backupctl restore <project> <snapshot-id> <target-path> --decompress` | Decompress dump after restore (gunzip/pg_restore extract) |
| `backupctl restore <project> <snapshot-id> <target-path> --guide` | Print step-by-step import instructions for the restored dump |
| `backupctl cache <project>` | Show restic cache size for a project |
| `backupctl cache <project> --clear` | Clear restic cache for a project |
| `backupctl cache --clear-all` | Clear restic cache for all projects |

> **Note:** `deploy` is NOT a CLI command. Use `scripts/deploy.sh` from the host. See section 8.4.

### 8.2 Restic Passthrough

The `restic` subcommand resolves the project's `RESTIC_REPOSITORY` and `RESTIC_PASSWORD` from YAML config, sets them as environment variables, and executes the restic command directly. You never need to manually export env vars.

```bash
# List snapshots (raw restic output)
backupctl restic vinsware snapshots

# Check repo integrity
backupctl restic vinsware check

# Show repo stats
backupctl restic vinsware stats

# Diff two snapshots
backupctl restic vinsware diff abc123 def456

# Mount repo for browsing (requires FUSE)
backupctl restic vinsware mount /mnt/restore

# Show files in a snapshot
backupctl restic vinsware ls latest

# Find a file across snapshots
backupctl restic vinsware find "*.sql.gz"

# Unlock a stuck repo
backupctl restic vinsware unlock

# Show raw key info
backupctl restic vinsware key list

# Cat a file from a snapshot
backupctl restic vinsware dump latest /data/backups/vinsware/backup_2026-03-18.sql.gz

# Initialize repo (one-time setup)
backupctl restic vinsware init
```

**How it works internally:**

```typescript
// restic.command.ts (simplified)
async run(project: string, resticArgs: string[]): Promise<void> {
  const config = this.configLoader.getProject(project);
  const repo = this.buildRepoUrl(config);
  const password = config.restic.password || process.env.RESTIC_PASSWORD;

  const result = await execFile('restic', resticArgs, {
    env: {
      ...process.env,
      RESTIC_REPOSITORY: repo,
      RESTIC_PASSWORD: password,
    },
  });

  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
}
```

### 8.3 CLI Usage Examples

```bash
# --- Backup operations ---
backupctl run vinsware                          # Run backup now
backupctl run --all                            # Backup all projects (sequential)

# --- Status & monitoring ---
backupctl health                               # Full health check
backupctl status                               # All projects summary
backupctl status vinsware                       # Detailed vinsware history
backupctl status vinsware --last 5              # Last 5 entries

# --- Restore ---
backupctl restore vinsware a1b2c3d4 /data/restore/vinsware
backupctl restore vinsware latest /data/restore/vinsware
backupctl restore vinsware latest /data/restore/vinsware --only db      # DB dump only
backupctl restore vinsware latest /data/restore/vinsware --only assets  # Assets only

# --- Snapshots ---
backupctl snapshots vinsware                    # All snapshots (with tags)
backupctl snapshots vinsware --last 10          # Last 10

# --- Prune ---
backupctl prune vinsware                        # Prune vinsware
backupctl prune --all                          # Prune all

# --- Logs ---
backupctl logs vinsware                         # All logs
backupctl logs vinsware --last 20               # Last 20
backupctl logs vinsware --failed                # Failed only

# --- Config ---
backupctl config validate                      # Validate everything
backupctl config show vinsware                  # Show resolved config
backupctl config reload                        # Reload YAML + re-register crons
backupctl config import-gpg-key ./keys/vinsware.pub.gpg  # Import GPG key

# --- Dry run ---
backupctl run vinsware --dry-run                # Validate without executing

# --- Restore with guidance ---
backupctl restore vinsware latest /data/restore/vinsware --decompress         # Extract + decompress
backupctl restore vinsware latest /data/restore/vinsware --guide              # Print import instructions
backupctl restore vinsware latest /data/restore/vinsware --decompress --guide # Both

# --- Cache management ---
backupctl cache vinsware                        # Show cache size
backupctl cache vinsware --clear                # Clear project cache
backupctl cache --clear-all                    # Clear all caches

# --- Restic passthrough ---
backupctl restic vinsware snapshots             # Raw restic snapshots
backupctl restic vinsware check                 # Repo integrity
backupctl restic vinsware stats                 # Repo stats
backupctl restic vinsware diff abc123 def456    # Diff snapshots
backupctl restic vinsware ls latest             # List files in latest
backupctl restic vinsware find "*.sql.gz"       # Find files
backupctl restic vinsware unlock                # Unlock stuck repo
backupctl restic vinsware init                  # Init new repo
```

### 8.4 Deploy Script (`scripts/deploy.sh`) — Host Only

Deploy is a **host-side script**, not a CLI command inside the container (you cannot rebuild the container from within it).

```bash
#!/bin/bash
set -e

echo "=== backupctl deploy ==="

# Validate config first
echo "[1/4] Validating config..."
docker exec backupctl node dist/cli.js config validate || echo "Container not running, skipping validation"

# Build
echo "[2/4] Building Docker image..."
docker compose -f docker-compose.yml build

# Start
echo "[3/4] Starting containers..."
docker compose -f docker-compose.yml up -d

# Health check
echo "[4/4] Running health check..."
sleep 5
docker exec backupctl node dist/cli.js health

echo "=== backupctl deployed successfully ==="
```

### 8.5 Management Script (`scripts/backupctl-manage.sh`) — Host Only

A comprehensive bash script for host-side operations: setup, deployment, prerequisite checks, and management.

```bash
#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

usage() {
  echo "Usage: backupctl-manage <command>"
  echo ""
  echo "Commands:"
  echo "  setup          Interactive first-time setup (SSH keys, known_hosts, .env, GPG keys, restic init)"
  echo "  check          Verify all prerequisites (Docker, restic, SSH, .env, YAML, GPG keys, disk space)"
  echo "  deploy         Build and start containers"
  echo "  deploy --rebuild  Rebuild image and restart"
  echo "  update         Pull latest, rebuild, run migrations, restart"
  echo "  logs           Tail container logs"
  echo "  shell          Open shell inside backupctl container"
  echo "  backup-dir     Show backup directory sizes"
  echo "  status         Quick status overview (container + last backup per project)"
}

# ... subcommands
```

#### `backupctl-manage setup` (interactive)

Walks through first-time setup:

1. Check Docker and Docker Compose are installed
2. Generate SSH key pair (if `./ssh-keys/id_ed25519` doesn't exist)
3. Prompt for Hetzner storage box credentials, test SSH, save `known_hosts`
4. Generate `.env` from `.env.example` with prompted values
5. Prompt for GPG public key files, copy to `./gpg-keys/`
6. Start containers (`docker compose up -d`)
7. Run migrations (`docker exec backupctl npx typeorm migration:run ...`)
8. Run health check (`docker exec backupctl node dist/cli.js health`)
9. Initialize restic repos for all projects in YAML

#### `backupctl-manage check`

Non-interactive prerequisite validation:

1. Docker daemon running
2. Docker Compose available
3. `.env` exists and all required vars are set
4. `config/projects.yml` exists and is valid YAML
5. SSH key exists at `./ssh-keys/id_ed25519`
6. `known_hosts` exists and contains Hetzner host
7. GPG keys exist in `./gpg-keys/` for all projects with encryption enabled
8. Disk space above threshold
9. Container is running (if checking a live deployment)

Reports pass/fail per check. Exit code 0 only if all pass.

---

## 9. HTTP Endpoints (Internal Only)

Minimal endpoints for container orchestration. Not exposed publicly — internal Docker network only.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Returns service health: audit DB connection, disk space, uptime |
| `/status` | GET | Returns last backup status for all projects |
| `/status/:project` | GET | Returns backup history for a specific project |

No authentication — internal network only as per requirement.

---

## 10. Docker Setup

### 10.1 Dockerfile

```dockerfile
FROM node:20-alpine

RUN apk add --no-cache \
    --repository=https://dl-cdn.alpinelinux.org/alpine/edge/main \
    --repository=https://dl-cdn.alpinelinux.org/alpine/v3.20/community \
    postgresql17-client \
    mariadb-client \
    mongodb-tools \
    openssh-client \
    gnupg \
    fuse3 \
    bzip2

# Install restic
RUN wget https://github.com/restic/restic/releases/download/v0.17.3/restic_0.17.3_linux_amd64.bz2 \
    && bunzip2 restic_0.17.3_linux_amd64.bz2 \
    && chmod +x restic_0.17.3_linux_amd64 \
    && mv restic_0.17.3_linux_amd64 /usr/local/bin/restic

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist/ ./dist/
COPY config/ ./config/

EXPOSE ${APP_PORT}
CMD ["node", "dist/main.js"]
```

### 10.2 Docker Compose (`docker-compose.yml`)

```yaml
version: "3.8"

services:
  backupctl:
    container_name: backupctl
    build:
      context: .
      dockerfile: Dockerfile
    env_file: .env
    ports:
      - "${APP_PORT}:${APP_PORT}"
    volumes:
      - /data/backups:/data/backups
      - ./config:/app/config:ro
      - ./ssh-keys:/root/.ssh:ro
      - ./gpg-keys:/app/gpg-keys:ro
      # Mount asset directories (add all paths referenced in projects.yml)
      - /data/vinsware/uploads:/data/vinsware/uploads:ro
      - /data/vinsware/assets:/data/vinsware/assets:ro
      - /data/projectx/storage:/data/projectx/storage:ro
    networks:
      - backupctl-network
    depends_on:
      - backupctl-audit-db
    restart: unless-stopped

  backupctl-audit-db:
    container_name: backupctl-audit-db
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ${AUDIT_DB_NAME}
      POSTGRES_USER: ${AUDIT_DB_USER}
      POSTGRES_PASSWORD: ${AUDIT_DB_PASSWORD}
    volumes:
      - backupctl-audit-data:/var/lib/postgresql/data
    networks:
      - backupctl-network
    restart: unless-stopped

volumes:
  backupctl-audit-data:

networks:
  backupctl-network:
    external: true
```

---

## 11. Hetzner Storage Box + Restic Setup

### 11.1 One-Time Setup

```bash
# 1. Generate SSH key
ssh-keygen -t ed25519 -f ./ssh-keys/id_ed25519 -N ""

# 2. Copy public key to Hetzner storage box
cat ./ssh-keys/id_ed25519.pub | ssh u123456@u123456.your-storagebox.de \
    install-ssh-key

# 3. Test SSH connection and capture known_hosts
ssh -i ./ssh-keys/id_ed25519 u123456@u123456.your-storagebox.de ls
# Save the host key to known_hosts for the container:
ssh-keyscan u123456.your-storagebox.de > ./ssh-keys/known_hosts

# 4. Start backupctl and run health check (verifies SSH + audit DB)
scripts/deploy.sh
# Health check also validates SSH: if known_hosts is missing, shows fingerprint
# and prompts for confirmation (interactive only, fails in cron)

# 5. Initialize restic repo per project
backupctl restic vinsware init
backupctl restic project-x init
backupctl restic project-y init
```

**SSH known_hosts:** The `known_hosts` file must be included in `./ssh-keys/` for non-interactive operation (cron, scheduler). During initial setup, `backupctl health` can interactively verify and save the host key if `known_hosts` is missing. In production (cron), a missing `known_hosts` entry causes SSH to **fail loudly** — no silent TOFU.

### 11.2 Restic Repository Structure on Storage Box

```
/backups/
├── vinsware/
│   ├── config
│   ├── data/
│   ├── index/
│   ├── keys/
│   └── snapshots/
├── project-x/
└── project-y/
```

---

## 12. Audit Trail

### 12.1 Entity: `BackupLog`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key (generated at backup start, used as run identifier) |
| `project_name` | VARCHAR | Project identifier |
| `status` | ENUM | `started`, `success`, `failed` |
| `current_stage` | VARCHAR | Current/last stage being executed (updated per step) |
| `started_at` | TIMESTAMP | Backup start time |
| `completed_at` | TIMESTAMP | Backup end time (null while in progress) |
| `dump_size_bytes` | BIGINT | Size of the DB dump |
| `encrypted` | BOOLEAN | Whether dump was encrypted |
| `verified` | BOOLEAN | Whether dump was verified |
| `snapshot_id` | VARCHAR | Restic snapshot ID (null if failed before sync) |
| `snapshot_mode` | VARCHAR | `combined` or `separate` |
| `files_new` | INT | New files in snapshot |
| `files_changed` | INT | Changed files in snapshot |
| `bytes_added` | BIGINT | Bytes added to restic repo |
| `prune_snapshots_removed` | INT | Snapshots pruned |
| `local_files_cleaned` | INT | Local dumps removed |
| `error_stage` | VARCHAR | Stage where failure occurred (null if success) |
| `error_message` | TEXT | Error details (null if success) |
| `retry_count` | INT | Number of retries attempted |
| `duration_ms` | BIGINT | Total backup duration |
| `created_at` | TIMESTAMP | Record creation time |

### 12.2 Audit Write Pattern

The audit log uses an **insert + update** pattern per backup run:

1. **Step 1 (start):** INSERT row with `id: uuid`, `status: started`, `started_at`, `current_stage: 'notify_started'`
2. **Steps 2-9:** UPDATE same row with `current_stage` as each step begins (e.g., `dump`, `verify`, `sync`)
3. **Step 10 (end):** UPDATE same row with final `status: success/failed`, `completed_at`, all result fields

The UUID ties together audit record, logs, and notifications for a single run. Orphaned `started` records (no `completed_at`) are detected during crash recovery.

### 12.3 Schema Management

Audit DB schema is managed via **explicit TypeORM migrations** (not `synchronize: true`). Migrations run via a dedicated command on startup or manually:

```bash
# Run pending migrations
npx typeorm migration:run -d src/adapters/audit/data-source.ts

# Generate migration from entity changes
npx typeorm migration:generate -d src/adapters/audit/data-source.ts src/adapters/audit/migrations/AddCurrentStage
```

---

## 13. Slack Notification Format

### 13.1 Backup Started

```
🔄 Backup started — vinsware
Time: 2026-03-18 00:00:00 IST
```

### 13.2 Backup Success

```
✅ Backup completed — vinsware
DB: vinsware_db | Dump: 245 MB | Encrypted: Yes | Verified: Yes
Snapshot: a1b2c3d4 | Mode: combined
New files: 12 | Changed: 3 | Added: 52 MB
Pruned: 2 snapshots | Local cleaned: 1 file
Duration: 3m 12s
```

### 13.3 Backup Failed

```
❌ Backup failed — vinsware
Stage: restic sync | Retry: 3/3
Error: connection timeout to storage box
Dump file: /data/backups/vinsware/backup_2026-03-18_000000.sql.gz
Duration: 5m 42s
```

### 13.4 Backup Timeout Warning

```
⚠️ Backup timeout warning — vinsware
Elapsed: 35m | Timeout threshold: 30m
Current stage: restic sync
Backup is still running — this is a warning, not a failure.
```

### 13.5 Daily Summary

```
📊 Daily Backup Summary — 2026-03-18

✅ vinsware      — 245 MB — 3m 12s — a1b2c3d4
✅ project-x    — 128 MB — 1m 45s — e5f6g7h8
❌ project-y    — FAILED — restic sync timeout

Total: 2/3 successful | Next run: per project schedule
```

### 13.6 Webhook Notification Payload

The webhook notifier POSTs `application/json` with a `text` field containing the same markdown-formatted report as Slack, plus structured `data`:

```json
{
  "event": "backup_success",
  "project": "vinsware",
  "text": "✅ Backup completed — vinsware\nDB: vinsware_db | Dump: 245 MB | Encrypted: Yes | Verified: Yes\nSnapshot: a1b2c3d4 | Mode: combined\nNew files: 12 | Changed: 3 | Added: 52 MB\nPruned: 2 snapshots | Local cleaned: 1 file\nDuration: 3m 12s",
  "data": {
    "run_id": "uuid",
    "project_name": "vinsware",
    "status": "success",
    "snapshot_id": "a1b2c3d4",
    "dump_size_bytes": 257949696,
    "encrypted": true,
    "verified": true,
    "duration_ms": 192000,
    "timestamp": "2026-03-18T00:03:12+01:00"
  }
}
```

Events: `backup_started`, `backup_success`, `backup_failed`, `backup_warning`, `daily_summary`.

### 13.7 Email TLS Configuration

Email notification config supports explicit TLS control:

```yaml
notification:
  type: email
  config:
    smtp_host: smtp.gmail.com
    smtp_port: 587
    smtp_secure: true          # true = TLS/STARTTLS, false = plain
    to: devops@company.com
    from: backup@company.com
    password: ${EMAIL_PASSWORD}
```

---

## 14. Testing Strategy

### 14.1 Test Structure

```
test/
├── unit/
│   ├── shared/                          # child-process util, format util
│   ├── domain/
│   │   ├── backup/
│   │   │   ├── models/                  # Value object validation, accessors
│   │   │   └── policies/               # Retry policy pure function
│   │   ├── audit/models/               # Health check result
│   │   └── config/models/              # ProjectConfig, RetentionPolicy validation
│   ├── application/
│   │   ├── backup/
│   │   │   ├── backup-orchestrator.service.spec.ts
│   │   │   ├── cache-management.service.spec.ts
│   │   │   └── registries/             # Dumper/notifier registry
│   │   ├── audit/
│   │   │   ├── audit-query.service.spec.ts
│   │   │   └── startup-recovery.service.spec.ts
│   │   ├── health/                     # Health check service
│   │   └── snapshot/                   # Snapshot management service
│   └── infrastructure/
│       ├── adapters/
│       │   ├── dumpers/                # pg_dump/mysqldump/mongodump command args
│       │   ├── storage/               # Restic args, JSON parsing, tagging
│       │   ├── notifiers/             # Slack/email/webhook payload format
│       │   ├── encryptors/            # GPG commands + key manager
│       │   ├── cleanup/              # File age filtering, deletion
│       │   ├── hooks/                # Shell command execution
│       │   └── config/              # YAML loading, ${} resolution, validation, reload
│       ├── persistence/
│       │   ├── audit/               # TypeORM insert+update, entity mapping, orphan query
│       │   ├── fallback/            # JSONL write/read/replay
│       │   └── lock/               # File-based acquire/release/queue
│       ├── cli/                     # Command arg parsing, exit codes, output formatting
│       ├── http/                    # Controller response shape
│       └── scheduler/               # Cron registration with lock
└── integration/
    ├── config/                      # Full YAML + .env end-to-end
    ├── audit/                       # TypeORM CRUD + migrations against test PostgreSQL
    ├── flow/                        # Full backup flow with test DB + local restic
    └── cli/                         # End-to-end CLI via CommandTestFactory
```

### 14.2 Unit Tests (Jest)

| Layer | Target | What to test |
|-------|--------|-------------|
| **Domain** | `RetentionPolicy` | Rejects negative days, validates keep_daily >= 0 |
| **Domain** | `ProjectConfig` | `hasEncryption()`, `hasHooks()`, `hasTimeout()`, `hasAssets()` accessors |
| **Domain** | `BackupStageError` | Stage, retryable flag, message propagation |
| **Domain** | `retry.policy.ts` | Retryable/non-retryable stages, exponential backoff, max attempts |
| **Application** | `BackupOrchestratorService` | 11-step call order, `current_stage` updates, lock acquire/release, dry run (no side effects), retry on failure, fallback on audit DB down, fallback on notification failure, timeout warning, missing assets skipped, `run --all` continues on individual failure |
| **Application** | `StartupRecoveryService` | Orphan marking, dump cleanup, restic unlock, JSONL fallback replay, GPG key import |
| **Application** | `CacheManagementService` | Delegates to `RemoteStoragePort.getCacheInfo()` / `clearCache()` |
| **Application** | `DumperRegistry` / `NotifierRegistry` | Register, resolve, resolve-unknown-throws |
| **Application** | `HealthCheckService` | Disk threshold check, SSH TCP + auth, audit DB ping, restic repo check (enabled only) |
| **Infrastructure** | `PostgresDumpAdapter` | Mock execFile. pg_dump args, custom format, output path, verify via pg_restore --list |
| **Infrastructure** | `MysqlDumpAdapter` | Mock execFile. mysqldump args, gzip pipe, verify via gunzip -t |
| **Infrastructure** | `MongoDumpAdapter` | Mock execFile. mongodump args, --gzip, verify via mongorestore --dryRun |
| **Infrastructure** | `ResticStorageAdapter` | Mock execFile. Sync with tags + snapshotMode, prune with retention, restore with includePaths, passthrough, cache, unlock |
| **Infrastructure** | `SlackNotifierAdapter` | Mock axios. Payload for all 5 notification types (started, success, failure, warning, daily summary) |
| **Infrastructure** | `EmailNotifierAdapter` | Mock nodemailer. Email content, recipients, `smtp_secure` TLS |
| **Infrastructure** | `WebhookNotifierAdapter` | Mock axios. JSON payload with `text` (markdown) + `data` (structured) |
| **Infrastructure** | `GpgEncryptorAdapter` | Mock execFile. GPG encrypt/decrypt command args |
| **Infrastructure** | `GpgKeyManager` | Mock execFile. Auto-import from directory, import single key |
| **Infrastructure** | `YamlConfigLoader` | `${}` resolution, fallback chains, validation errors, reload |
| **Infrastructure** | `TypeormAuditLogAdapter` | Mock TypeORM repo. startRun/trackProgress/finishRun, findOrphaned |
| **Infrastructure** | `JsonlFallbackWriter` | Mock fs. Append JSONL, read entries, clear replayed |
| **Infrastructure** | `FileBackupLock` | Mock fs. Create/check/remove `.lock` files, acquireOrQueue waits |
| **Infrastructure** | `DynamicSchedulerService` | Cron registration per project, lock integration, re-registration on reload |
| **Infrastructure** | CLI commands | Argument parsing, exit codes (0-5), output formatting, --dry-run, --only, --decompress, --guide, --clear |

### 14.3 Integration Tests

| Target | What to test |
|--------|-------------|
| Config loading | YAML + .env resolution end-to-end, `${}` with real env vars |
| Audit DB | TypeORM entity CRUD + migrations against test PostgreSQL |
| Fallback + replay | Write JSONL, crash, restart, verify replay into audit DB |
| Full backup flow | Orchestrator with real adapters against test DB + local restic repo |
| CLI end-to-end | Commands via `CommandTestFactory`, verify exit codes |

### 14.4 TDD Approach

1. Write port interfaces (domain).
2. Write orchestrator tests against mocked ports.
3. Implement orchestrator to pass tests.
4. Write adapter tests.
5. Implement adapters to pass tests.
6. Write CLI command tests.
7. Implement CLI commands.
8. Integration tests last.

### 14.5 CLI Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General failure |
| `2` | Backup already in progress (lock held) |
| `3` | Configuration validation error |
| `4` | Connectivity error (DB, SSH, restic unreachable) |
| `5` | Partial success (`run --all`: some projects succeeded, some failed) |

---

## 15. Documentation

### 15.1 Required Documentation

| Document | Location | Content |
|----------|----------|---------|
| `README.md` | Root | Project overview, quick start, architecture diagram, CLI quick reference |
| `docs/setup.md` | docs/ | Full setup guide: prerequisites, Hetzner storage box setup, SSH keys, Docker build, first run |
| `docs/configuration.md` | docs/ | Complete `.env` and YAML reference with all options, defaults, fallback rules, and examples |
| `docs/cli.md` | docs/ | Full CLI command reference with examples for every command including restic passthrough |
| `docs/adding-adapters.md` | docs/ | Step-by-step guide for adding new DB dumper, storage, or notifier adapters |
| `docs/restore.md` | docs/ | Step-by-step restore procedures for each DB type, including restic mount and dump |
| `docs/troubleshooting.md` | docs/ | Common issues, debug steps, log locations, restic unlock, SSH issues |
| `CHANGELOG.md` | Root | Version history |

---

## 16. Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 20 LTS |
| Framework | NestJS 11 |
| CLI | nest-commander |
| ORM | TypeORM |
| Audit DB | PostgreSQL 16 (separate container) |
| Scheduler | @nestjs/schedule |
| Config | @nestjs/config + js-yaml |
| Logging | Winston (nest-winston) with rotation |
| Testing | Jest |
| Container | Docker + Docker Compose |
| OS | Ubuntu 24.04 (host) |
| Remote storage | Restic → Hetzner Storage Box (SFTP) |
| Encryption | GPG |

---

## 17. Dependencies (npm)

| Package | Purpose |
|---------|---------|
| `@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express` | NestJS core |
| `@nestjs/schedule` | Cron scheduling |
| `@nestjs/config` | Environment config |
| `@nestjs/typeorm`, `typeorm`, `pg` | Audit DB |
| `nest-commander` | CLI framework |
| `js-yaml`, `@types/js-yaml` | YAML config parsing |
| `axios` | Slack webhook / HTTP notifications |
| `nodemailer`, `@types/nodemailer` | Email notifications |
| `uuid`, `@types/uuid` | Unique IDs |
| `winston`, `nest-winston`, `winston-daily-rotate-file` | Structured logging with rotation |

Dev dependencies: `jest`, `@nestjs/testing`, `ts-jest`, `supertest`, `@types/jest`

---

## 18. Future Scope (v2+)

- Web dashboard for backup status and history
- S3 / Backblaze B2 storage adapter
- WAL-based continuous backup for PostgreSQL
- Multi-node coordination for distributed setups
- Backup integrity verification via periodic restore tests
- Prometheus metrics export
- Telegram / Discord notifier adapters
- `backupctl watch` — live tail of backup progress

---

## 19. Milestones

| Phase | Scope | Estimate |
|-------|-------|----------|
| Phase 1 | Project scaffolding, shared utils, domain models, policies, ports | 2-3 days |
| Phase 2 | Application layer: orchestrator, registries, health/snapshot/audit services | 2-3 days |
| Phase 3 | Config + clock adapters, YAML loader, env resolution | 1-2 days |
| Phase 4 | Database dumpers (postgres, mysql, mongo), restic storage adapter | 2-3 days |
| Phase 5 | Notifiers (slack, email, webhook), GPG encryptor, hooks, cleanup | 2-3 days |
| Phase 6 | Audit module (TypeORM, migrations, fallback file), crash recovery | 1-2 days |
| Phase 7 | Scheduler (concurrency lock, queue), backup lock manager | 1 day |
| Phase 8 | CLI commands (14 commands: run, status, health, restore, snapshots, prune, logs, config, restic, cache) | 2-3 days |
| Phase 9 | HTTP controllers, dry run, timeout alerting | 1 day |
| Phase 10 | Docker, management scripts (setup, check, deploy), GPG key auto-import | 1-2 days |
| Phase 11 | Integration tests, documentation | 2-3 days |
| **Total** | | **16-23 days** |
