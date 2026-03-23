# Requirements

A readable summary of what backupctl does, what it requires, and how its features are organized. For the complete, unabridged requirements document, see [docs/initial/prd.md](initial/prd.md).

## Overview

backupctl is a standalone, generic, database-agnostic backup orchestration service. It runs as an independent Docker container alongside a dedicated PostgreSQL audit database, manages scheduled backups for multiple projects via a single YAML config file, syncs encrypted and deduplicated snapshots to a Hetzner Storage Box via restic over SFTP, and provides a full CLI for every operational task.

backupctl is not tied to any specific project, database engine, or notification provider. Everything is configurable through `config/projects.yml` and `.env`.

## Goals

- **Generic** — supports any database (PostgreSQL, MySQL, MongoDB) and notification channel (Slack, Email, Webhook) via the adapter pattern. Adding a new database or notifier means implementing a single port interface.
- **Multi-project** — a single service instance backs up multiple projects, each with its own schedule, database connection, asset paths, retention policy, encryption settings, and notification configuration.
- **Hexagonal architecture** — domain logic has zero infrastructure dependencies. Ports define contracts; adapters fulfill them. The domain layer contains no NestJS imports, no TypeORM, no decorators.
- **TDD** — full test coverage with Jest. Domain logic, orchestration flows, adapters, persistence, and CLI commands are all independently testable.
- **CLI-first management** — all operations are available through 14 nest-commander CLI commands, including restic passthrough per project.
- **Production-ready** — GPG encryption, pre/post hooks, dump verification, configurable retries with exponential backoff, a persistent audit trail with JSONL fallback, crash recovery on startup, and per-project file-based locking.

## Non-Goals (v1)

These are explicitly out of scope for the initial version:

- Web-based dashboard or UI
- Multi-node / distributed backup coordination
- Streaming / WAL-based continuous backup (point-in-time recovery)
- Backup of non-filesystem assets (e.g., S3 buckets)
- Multiple notification channels per project (single channel only)
- Automatic database import on restore (files are extracted; the user runs `pg_restore` / `mysql` / `mongorestore` manually, with optional `--guide` instructions)

## Functional Requirements

### Backup Orchestration

The core backup flow is an 11-step pipeline, executed per project:

```
 0.  Acquire per-project file-based lock
 0b. AuditLogPort.startRun() → returns runId
 1.  Notify started
 2.  Execute pre-backup hook (if configured)
 3.  Dump database                          ┐
 4.  Verify dump                            │ retryable stages
 5.  Encrypt dump (if enabled)              │ (exponential backoff)
 6.  Sync to remote storage (restic)        │
 7.  Prune old snapshots                    │
 8.  Clean up local dumps                   ┘
 9.  Execute post-backup hook (if configured)
10.  Finalize audit record (fallback to JSONL if DB down)
11.  Notify success or failure (fallback to JSONL if fails)
12.  Release lock (always, even on failure)
```

Key behaviors:

- **Per-project file-based lock** — `.lock` files at `{BACKUP_BASE_DIR}/{project}/.lock` prevent concurrent backups. Cron overlap queues behind the running backup. CLI collision rejects with exit code `2`.
- **Retry with exponential backoff** — stages 3–8 retry up to `BACKUP_RETRY_COUNT` times (default 3) with `BACKUP_RETRY_DELAY_MS` (default 5000ms) exponential backoff. Hooks, audit, and notification stages are non-retryable.
- **Timeout alerting** — if `timeout_minutes` is configured and exceeded, a warning notification fires. The backup is NOT killed — it continues running.
- **Dry run mode** — `--dry-run` validates config, checks DB connectivity, verifies restic repo access, tests SSH, checks disk space, and validates GPG key availability — without dumping, syncing, or modifying anything.
- **Stage progress tracking** — `AuditLogPort.trackProgress(runId, stage)` is called at each step, updating `current_stage` in real time.
- **Sequential multi-project runs** — `run --all` executes projects in YAML order. If one project fails, the rest still run. Exit code `5` indicates partial success.

### Database Support

| Database   | Dump tool    | Compression         | Verification               |
|------------|-------------|---------------------|-----------------------------|
| PostgreSQL | `pg_dump`   | `--format=custom`   | `pg_restore --list`         |
| MySQL      | `mysqldump` | piped through gzip  | `gunzip -t`                 |
| MongoDB    | `mongodump` | `--gzip`            | `mongorestore --dryRun`     |

Compression is always enabled — there is no toggle. Each dumper adapter uses the best compression method for its database type.

### Remote Storage

- **Restic over SFTP** to a Hetzner Storage Box.
- **Snapshot tagging** — snapshots are tagged with `project:{name}` and `backupctl:combined`, `backupctl:db`, or `backupctl:assets:{path}` depending on snapshot mode.
- **Snapshot modes** — `combined` creates one snapshot containing both database dump and asset paths. `separate` creates individual snapshots for the dump and each asset path.
- **Retention-based pruning** — configurable `keep_daily`, `keep_weekly`, `keep_monthly` per project.
- **Cache management** — CLI commands to inspect and clear restic's local cache per project.
- **Restic passthrough** — `backupctl restic <project> <cmd>` runs any restic command with the project's credentials pre-configured.

### Notifications

| Channel | Transport | Config |
|---------|-----------|--------|
| Slack   | Webhook URL (HTTP POST) | `webhook_url` |
| Email   | SMTP with explicit TLS control (`smtp_secure`) | `smtp_host`, `smtp_port`, `smtp_secure`, `to`, `from`, `password` |
| Webhook | HTTP POST with JSON + markdown body | `url` |

Events: `backup_started`, `backup_success`, `backup_failed`, `backup_warning`, `daily_summary`.

If notification delivery fails, the payload is written to the JSONL fallback file and retried on next startup. Notification failure is never a backup failure.

### Encryption

- **GPG encryption** of dump files before remote sync.
- **Auto-import** of GPG public keys from the mounted `gpg-keys/` directory on every startup.
- **Per-project or global** — encryption can be enabled globally via `.env` or per-project in YAML. Project settings override globals.
- **Manual import** — `backupctl config import-gpg-key <file>` for ad-hoc key additions.

### Audit Trail

A PostgreSQL audit database (separate container) tracks every backup run with real-time stage progress.

- **Insert + update pattern** — `startRun()` inserts a row with `status: started`, each stage updates `current_stage`, and `finishRun()` writes the final status with all result fields.
- **Orphan detection** — records with `status = 'started'` and `completed_at IS NULL` are detected during crash recovery and marked as `failed`.
- **JSONL fallback** — when the audit DB is unavailable, results are appended to `{BACKUP_BASE_DIR}/.fallback-audit/fallback.jsonl` and replayed on next startup.
- **Schema management** — explicit TypeORM migrations, never `synchronize: true`.

### Crash Recovery

`RecoverStartupUseCase` runs on every container start (`onModuleInit`):

1. **Orphaned records** — query for `status = 'started'` with `completed_at IS NULL`, mark as `failed` with `error_stage = 'crash_recovery'`
2. **Orphaned dump files** — scan project directories for dump files not associated with a successful audit record
3. **Stale lock files** — remove `.lock` files left behind by crashed processes
4. **Restic repo unlock** — auto-unlock all enabled project repos (safe because no backups run during startup)
5. **JSONL fallback replay** — replay pending audit and notification entries into their respective systems
6. **GPG key import** — auto-import all `.gpg` public key files from the mounted `gpg-keys/` directory

### CLI

14 commands via `backupctl <command>`:

| Command | Description |
|---------|-------------|
| `run <project> [--all] [--dry-run]` | Trigger backup or simulate |
| `status [project] [--last n]` | Backup status with `current_stage` visibility |
| `health` | Check audit DB, restic repos, disk space, SSH |
| `restore <project> <snap> <path> [--only db\|assets] [--decompress] [--guide]` | Restore snapshots with optional decompress and import guidance |
| `snapshots <project> [--last n]` | List restic snapshots with tags |
| `prune <project> / --all` | Manual restic prune |
| `logs <project> [--last n] [--failed]` | Query audit log |
| `config validate / show / reload / import-gpg-key <file>` | Config management |
| `cache <project> [--clear] / --clear-all` | Restic cache management |
| `restic <project> <cmd> [args...]` | Restic passthrough with auto-configured credentials |

Exit codes:

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General failure |
| `2` | Backup already in progress (lock held) |
| `3` | Configuration validation error |
| `4` | Connectivity error (DB, SSH, restic unreachable) |
| `5` | Partial success (`run --all` — some succeeded, some failed) |

### Configuration

- **`config/projects.yml`** — per-project settings: database, schedule, assets, retention, encryption, hooks, notifications.
- **`.env`** — global defaults and secrets: audit DB credentials, Hetzner SSH, restic password, notification defaults, retry settings.
- **`${VAR_NAME}` resolution** — variable references in YAML are resolved from `.env` at load time. Secrets always live in `.env` and are referenced via `${}` in YAML.
- **Resolution order** — project YAML > `.env` global > hardcoded defaults.
- **No hot-reload** — config changes require an explicit `backupctl config reload` command.

## Audit Schema

The `BackupLog` entity tracks every backup run:

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key, generated at backup start (used as run identifier) |
| `project_name` | VARCHAR | Project identifier |
| `status` | ENUM | `started`, `success`, `failed` |
| `current_stage` | VARCHAR | Current or last stage being executed (updated per step) |
| `started_at` | TIMESTAMP | Backup start time |
| `completed_at` | TIMESTAMP | Backup end time (null while in progress) |
| `dump_size_bytes` | BIGINT | Size of the database dump |
| `encrypted` | BOOLEAN | Whether the dump was encrypted |
| `verified` | BOOLEAN | Whether the dump was verified |
| `snapshot_id` | VARCHAR | Restic snapshot ID (null if failed before sync) |
| `snapshot_mode` | VARCHAR | `combined` or `separate` |
| `files_new` | INT | New files in snapshot |
| `files_changed` | INT | Changed files in snapshot |
| `bytes_added` | BIGINT | Bytes added to the restic repo |
| `prune_snapshots_removed` | INT | Snapshots removed during prune |
| `local_files_cleaned` | INT | Local dump files removed |
| `error_stage` | VARCHAR | Stage where failure occurred (null if success) |
| `error_message` | TEXT | Error details (null if success) |
| `retry_count` | INT | Number of retries attempted |
| `duration_ms` | BIGINT | Total backup duration in milliseconds |
| `created_at` | TIMESTAMP | Record creation time |

## Notification Formats

### Backup Started

```
🔄 Backup started — vinsware
Time: 2026-03-18 00:00:00 IST
```

### Backup Success

```
✅ Backup completed — vinsware
DB: vinsware_db | Dump: 245 MB | Encrypted: Yes | Verified: Yes
Snapshot: a1b2c3d4 | Mode: combined
New files: 12 | Changed: 3 | Added: 52 MB
Pruned: 2 snapshots | Local cleaned: 1 file
Duration: 3m 12s
```

### Backup Failed

```
❌ Backup failed — vinsware
Stage: restic sync | Retry: 3/3
Error: connection timeout to storage box
Dump file: /data/backups/vinsware/backup_2026-03-18_000000.sql.gz
Duration: 5m 42s
```

### Backup Timeout Warning

```
⚠️ Backup timeout warning — vinsware
Elapsed: 35m | Timeout threshold: 30m
Current stage: restic sync
Backup is still running — this is a warning, not a failure.
```

### Daily Summary

```
📊 Daily Backup Summary — 2026-03-18

✅ vinsware      — 245 MB — 3m 12s — a1b2c3d4
✅ project-x    — 128 MB — 1m 45s — e5f6g7h8
❌ project-y    — FAILED — restic sync timeout

Total: 2/3 successful | Next run: per project schedule
```

### Webhook Payload

The webhook notifier POSTs `application/json` with a `text` field containing the same markdown-formatted report, plus structured `data`:

```json
{
  "event": "backup_success",
  "project": "vinsware",
  "text": "✅ Backup completed — vinsware\nDB: vinsware_db | Dump: 245 MB ...",
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

## Docker Setup

backupctl runs as two containers via Docker Compose:

| Container | Image | Purpose |
|-----------|-------|---------|
| `backupctl` | Node.js 20 Alpine + DB clients + restic + GPG | Backup orchestration, CLI, scheduler, HTTP endpoints |
| `backupctl-audit-db` | PostgreSQL 16 Alpine | Audit trail database |

Volumes:

| Mount | Container path | Mode | Purpose |
|-------|---------------|------|---------|
| Host backup dir | `/data/backups` | rw | Dump storage, lock files, fallback audit, logs |
| `./config` | `/app/config` | ro | Project YAML configuration |
| `./ssh-keys` | `/root/.ssh` | ro | SSH key pair and `known_hosts` for Hetzner |
| `./gpg-keys` | `/app/gpg-keys` | ro | GPG public keys for dump encryption |
| Asset paths | Varies | ro | Project asset directories referenced in YAML |

The two containers communicate over a shared Docker network (`backupctl-network`). The audit database is not exposed to the host — only the backupctl container connects to it. The HTTP endpoints (health, status) are internal-only; there is no authentication.

## Full PRD

This page is a summary. For the complete, unabridged requirements document with full domain port interfaces, TypeScript code examples, testing strategy, Docker configuration, and deployment scripts, see [docs/initial/prd.md](initial/prd.md).

## What's Next

- **Get running** — [Installation](04-installation.md) walks through deploying backupctl on a fresh server.
- **Understand the design** — [Architecture](02-architecture.md) explains the hexagonal layer structure and key design decisions.
- **Quick reference** — [Cheatsheet](10-cheatsheet.md) has copy-paste commands for daily operations.
