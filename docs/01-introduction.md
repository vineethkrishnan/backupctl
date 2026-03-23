# Introduction

## What is backupctl

backupctl is a standalone Docker service that orchestrates scheduled, encrypted, deduplicated backups for multiple projects from a single deployment. You define your projects in a YAML config file — each with its own database, schedule, retention policy, and notification preferences — and backupctl handles the rest: dumping, compressing, encrypting, syncing to remote storage, pruning old snapshots, and logging every step to an audit trail.

The service supports PostgreSQL, MySQL, and MongoDB out of the box, with an extensible adapter pattern that makes adding new database types straightforward. Remote storage is handled by restic over SFTP to a Hetzner Storage Box, giving you encrypted, deduplicated backups with snapshot-based retention. Optional GPG encryption adds a second layer of protection for dump files before they leave the host.

backupctl is designed for operators who manage multiple databases across multiple projects and want a single, reliable, CLI-driven tool to handle all of their backups. It is not a web application — there is no dashboard. Everything is managed through 14 CLI commands, YAML configuration, and cron schedules that run automatically inside the container.

The project follows hexagonal architecture principles. The domain layer is pure TypeScript with zero framework dependencies, making the core logic easy to test and reason about. The application layer orchestrates backup flows through domain ports, and the infrastructure layer provides concrete adapters for databases, storage, notifications, and persistence. A full audit trail in PostgreSQL (with JSONL fallback) ensures that no backup result is ever lost, even if the audit database goes down mid-run.

## Key Features

### Multi-project orchestration

A single `config/projects.yml` file defines all your projects. Each project has its own database connection, schedule, retention policy, encryption settings, and notification channels. One backupctl instance handles them all.

### Database-agnostic

Supports PostgreSQL (`pg_dump`), MySQL (`mysqldump`), and MongoDB (`mongodump`) through a pluggable adapter pattern. Each adapter compresses output using the best method for its database type. Adding a new database type means implementing a single port interface.

### Restic remote storage

All backups are synced to remote storage using restic, which provides encryption, deduplication, and snapshot-based retention. The default transport is SFTP to a Hetzner Storage Box, but the adapter pattern allows other backends.

### GPG encryption

Optional per-project GPG encryption of dump files before remote sync. Keys are managed via a mounted directory and auto-imported on startup. The `config import-gpg-key` command handles manual imports.

### Notification channels

Get notified on backup start, success, failure, and warnings through Slack (webhook), Email (SMTP with explicit TLS control via `smtp_secure`), or Webhook (JSON payload with markdown-formatted text). A daily summary option is also available.

### Heartbeat monitoring

Optional Uptime Kuma integration provides passive failure detection via push monitors. After each backup, a heartbeat ping is sent with `up` or `down` status. If the ping stops (crashed container, stuck cron), Kuma detects the missing heartbeat and fires its own alerts — complementing the active notification system.

### Pre/post backup hooks

Run arbitrary shell commands before and after each backup. Useful for application-level maintenance mode, cache clearing, or custom validation scripts.

### Retry with exponential backoff

Stages 3 through 8 of the backup flow (dump, verify, encrypt, sync, prune, cleanup) are retryable with configurable exponential backoff. Non-retryable stages (hooks, audit, notify) fail immediately. The retry policy is a pure function in the domain layer.

### Audit trail

Every backup run is tracked in a PostgreSQL audit database with real-time stage progress. If the audit database is unavailable, results are written to a JSONL fallback file and replayed automatically on the next startup.

### Crash recovery

The `RecoverStartupUseCase` runs on every container start and handles: marking orphaned "started" records as failed, cleaning orphaned dump files, removing stale `.lock` files, auto-unlocking restic repos, replaying JSONL fallback entries, and auto-importing GPG keys.

### 14 CLI commands

Full lifecycle management: `run`, `status`, `health`, `restore`, `snapshots`, `prune`, `logs`, `config` (validate/show/reload/import-gpg-key), `cache`, and `restic` passthrough. Every command has structured exit codes for scripting.

### Dry run mode

`backupctl run <project> --dry-run` validates configuration and connectivity without executing the actual backup. Useful for testing new project configs before committing to a real run.

### Dynamic cron scheduling

Schedules are defined per-project in YAML and registered dynamically via `@nestjs/schedule`. Cron overlap is handled by the per-project lock — overlapping runs queue behind the active backup.

### Zero-edit installation wizard

The `backupctl-manage.sh setup` script walks through first-time configuration interactively, generating `.env` and `config/projects.yml` files without manual editing.

### Per-project file-based locking

Each project gets a `.lock` file at `{BACKUP_BASE_DIR}/{project}/.lock`. Locks survive crashes and are visible on disk. Cron-triggered runs queue behind a held lock; CLI-triggered runs reject immediately with exit code 2. Stale locks are cleaned on startup recovery.

## Design Goals

- **Generic** — not tied to any specific project or organization. Works with any PostgreSQL, MySQL, or MongoDB database.
- **Multi-project** — one service manages backups for many databases. No per-project deployment needed.
- **Hexagonal architecture** — the domain layer has zero infrastructure dependencies. Ports define contracts; adapters fulfill them.
- **TDD** — full test coverage with Jest. Domain logic, orchestration flows, adapters, and CLI commands are all tested.
- **CLI-first** — every operation is available through the CLI. No web UI required.
- **Production-ready** — crash recovery, audit logging, fallback persistence, structured error handling, and locked concurrency.

## Non-Goals (v1)

These are explicitly out of scope for the initial version:

- **No web dashboard** — all management is through CLI and config files.
- **No distributed coordination** — single-instance only. No clustering or leader election.
- **No WAL / continuous backup** — point-in-time snapshots only, not streaming replication.
- **No S3 bucket storage** — restic over SFTP to Hetzner Storage Box only (other backends possible via adapter).
- **No multi-channel per project** — each project sends notifications to one channel type.
- **No automatic database import on restore** — `restore` extracts files and provides a `--guide` with import instructions.

## Tech Stack

| Component | Technology |
|-----------------|------------------------------------------|
| Runtime | Node.js 20 LTS |
| Framework | NestJS 11 |
| Language | TypeScript 5.7 |
| CLI | nest-commander |
| ORM | TypeORM (explicit migrations) |
| Audit database | PostgreSQL 16 |
| Scheduler | @nestjs/schedule |
| Config | @nestjs/config + js-yaml |
| Logging | Winston (nest-winston) + daily rotation |
| HTTP client | Axios |
| Email | Nodemailer |
| Testing | Jest |
| Containers | Docker + Docker Compose |
| Remote storage | Restic (SFTP to Hetzner Storage Box) |
| Encryption | GPG |

## What's Next

- **Understand the design** — [Architecture](02-architecture.md) explains the hexagonal layer structure, domain subdomains, and key design decisions.
- **Set up backupctl** — [Installation](04-installation.md) walks through deployment on a fresh server.
- **Jump right in** — [Cheatsheet](10-cheatsheet.md) has copy-paste commands for the most common operations.
