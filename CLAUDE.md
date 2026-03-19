# backupctl

Database-agnostic backup orchestration service. NestJS 11, hexagonal architecture, CLI-first.

## Quick Reference

- **PRD**: `docs/initial/prd.md` (v1.1) — requirements, CLI spec, config format, notifications, concurrency, recovery
- **Architecture plan**: `.plans/20260318--hexagonal-architecture/plan.md` — hexagonal design decisions and rationale
- **Implementation plan**: `.plans/20260318--hexagonal-architecture/implementation.md` — 18-step build sequence
- **Entry points**: `src/main.ts` (HTTP), `src/cli.ts` (CLI via nest-commander)
- **Config**: `config/projects.yml` (per-project YAML) + `.env` (global secrets/defaults)
- **Audit DB**: PostgreSQL 16 via TypeORM with explicit migrations (separate container)
- **Remote storage**: Restic over SFTP to Hetzner Storage Box

## Git Workflow

This project uses **standard git** — do NOT use Graphite CLI (`gt`).

### Commands

```bash
git checkout -b <branch-name>    # create branch
git commit                       # commit (always via HEREDOC)
git push -u origin <branch>      # push
gh pr create                     # create PR
```

### Commit Messages

Follow Conventional Commits. Always use HEREDOC:

```bash
git commit -m "$(cat <<'EOF'
feat(orchestrator): add retry with exponential backoff (BCTL-12)

Implement configurable retry logic for steps 3-8 of the backup flow.
EOF
)"
```

**Rules:**
- Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `build`, `ci`, `perf`, `hotfix`
- Scope: lowercase with hyphens (`orchestrator`, `restic-adapter`, `cli`)
- Subject: imperative mood, lowercase start, under 72 chars, no trailing period
- Ticket: in parentheses at end of subject — pattern `BCTL-\d+`. If no ticket in branch name, ask the user
- Body: blank line after subject, explain what and why

### Branch Naming

```
feat/BCTL-12-retry-backoff
fix/BCTL-15-restic-timeout
chore/BCTL-20-update-deps
```

## Architecture

Hexagonal (Ports & Adapters) with **vertical-slice** (module-first) organization. Each domain module is self-contained with its own `domain/`, `application/`, `infrastructure/`, and `presenters/` layers.

```
src/
├── domain/                                    # All domain modules (vertical slices)
│   ├── backup/                                # Core backup module
│   │   ├── domain/                            # Pure TS — ZERO framework imports
│   │   │   ├── backup-result.model.ts
│   │   │   ├── backup-stage-error.ts
│   │   │   ├── value-objects/                 # Enums + immutable VOs
│   │   │   │   ├── backup-stage.enum.ts
│   │   │   │   ├── backup-status.enum.ts
│   │   │   │   ├── dump-result.model.ts
│   │   │   │   ├── sync-result.model.ts
│   │   │   │   ├── prune-result.model.ts
│   │   │   │   ├── cleanup-result.model.ts
│   │   │   │   ├── cache-info.model.ts
│   │   │   │   └── snapshot-info.model.ts
│   │   │   └── policies/
│   │   │       └── retry.policy.ts            # Pure function
│   │   ├── application/                       # Use cases + ports
│   │   │   ├── ports/                         # Outbound port interfaces
│   │   │   │   ├── database-dumper.port.ts
│   │   │   │   ├── remote-storage.port.ts
│   │   │   │   ├── remote-storage-factory.port.ts
│   │   │   │   ├── dump-encryptor.port.ts
│   │   │   │   ├── local-cleanup.port.ts
│   │   │   │   ├── hook-executor.port.ts
│   │   │   │   └── backup-lock.port.ts
│   │   │   ├── use-cases/                    # One directory per action, each with Command/Query + UseCase
│   │   │   │   ├── run-backup/
│   │   │   │   │   ├── run-backup.command.ts
│   │   │   │   │   └── run-backup.use-case.ts
│   │   │   │   ├── restore-backup/
│   │   │   │   │   ├── restore-backup.command.ts
│   │   │   │   │   └── restore-backup.use-case.ts
│   │   │   │   ├── get-restore-guide/
│   │   │   │   │   ├── get-restore-guide.query.ts
│   │   │   │   │   └── get-restore-guide.use-case.ts
│   │   │   │   ├── prune-backup/
│   │   │   │   │   ├── prune-backup.command.ts
│   │   │   │   │   └── prune-backup.use-case.ts
│   │   │   │   ├── list-snapshots/
│   │   │   │   │   ├── list-snapshots.query.ts
│   │   │   │   │   └── list-snapshots.use-case.ts
│   │   │   │   ├── get-cache-info/
│   │   │   │   │   ├── get-cache-info.query.ts
│   │   │   │   │   └── get-cache-info.use-case.ts
│   │   │   │   └── clear-cache/
│   │   │   │       ├── clear-cache.command.ts
│   │   │   │       └── clear-cache.use-case.ts
│   │   │   └── registries/
│   │   │       ├── dumper.registry.ts
│   │   │       └── notifier.registry.ts
│   │   ├── infrastructure/                    # Adapters implementing ports
│   │   │   ├── adapters/
│   │   │   │   ├── dumpers/                   # postgres, mysql, mongo
│   │   │   │   ├── storage/                   # restic + factory + tagging
│   │   │   │   ├── encryptors/                # gpg + key manager
│   │   │   │   ├── cleanup/                   # file cleanup
│   │   │   │   ├── hooks/                     # shell hook executor
│   │   │   │   └── lock/                      # file-based .lock
│   │   │   └── scheduler/
│   │   │       └── dynamic-scheduler.service.ts
│   │   ├── presenters/                        # Inbound (CLI + HTTP)
│   │   │   └── cli/
│   │   │       ├── run.command.ts
│   │   │       ├── restore.command.ts
│   │   │       ├── snapshots.command.ts
│   │   │       ├── prune.command.ts
│   │   │       ├── cache.command.ts
│   │   │       └── restic.command.ts
│   │   └── backup.module.ts                   # NestJS module barrel
│   │
│   ├── audit/                                 # Audit module
│   │   ├── domain/
│   │   │   └── health-check-result.model.ts
│   │   ├── application/
│   │   │   ├── ports/
│   │   │   │   ├── audit-log.port.ts
│   │   │   │   └── fallback-writer.port.ts
│   │   │   └── use-cases/
│   │   │       ├── get-backup-status/
│   │   │       │   ├── get-backup-status.query.ts
│   │   │       │   └── get-backup-status.use-case.ts
│   │   │       ├── get-failed-logs/
│   │   │       │   ├── get-failed-logs.query.ts
│   │   │       │   └── get-failed-logs.use-case.ts
│   │   │       └── recover-startup/
│   │   │           └── recover-startup.use-case.ts
│   │   ├── infrastructure/
│   │   │   └── persistence/
│   │   │       ├── typeorm/
│   │   │       │   ├── schema/
│   │   │       │   │   └── backup-log.record.ts
│   │   │       │   └── typeorm-audit-log.repository.ts
│   │   │       └── fallback/
│   │   │           └── jsonl-fallback-writer.adapter.ts
│   │   ├── presenters/
│   │   │   ├── cli/
│   │   │   │   ├── status.command.ts
│   │   │   │   └── logs.command.ts
│   │   │   └── http/
│   │   │       └── status.controller.ts
│   │   └── audit.module.ts
│   │
│   ├── config/                                # Config module
│   │   ├── domain/
│   │   │   ├── project-config.model.ts
│   │   │   └── retention-policy.model.ts
│   │   ├── application/
│   │   │   └── ports/
│   │   │       └── config-loader.port.ts
│   │   ├── infrastructure/
│   │   │   └── yaml-config-loader.adapter.ts
│   │   ├── presenters/
│   │   │   └── cli/
│   │   │       └── config.command.ts
│   │   └── config.module.ts
│   │
│   ├── notification/                          # Notification module
│   │   ├── application/
│   │   │   └── ports/
│   │   │       └── notifier.port.ts
│   │   ├── infrastructure/
│   │   │   ├── slack-notifier.adapter.ts
│   │   │   ├── email-notifier.adapter.ts
│   │   │   └── webhook-notifier.adapter.ts
│   │   └── notification.module.ts
│   │
│   └── health/                                # Health module
│       ├── application/
│       │   └── use-cases/
│       │       └── check-health/
│       │           └── check-health.use-case.ts
│       ├── presenters/
│       │   ├── cli/
│       │   │   └── health.command.ts
│       │   └── http/
│       │       └── health.controller.ts
│       └── health.module.ts
│
├── common/                                    # Cross-cutting (imported by any layer)
│   ├── di/
│   │   └── injection-tokens.ts                # All port DI tokens (Symbol-based)
│   ├── helpers/
│   │   ├── child-process.util.ts              # Safe execFile wrapper
│   │   └── format.util.ts                     # Byte/duration/timestamp formatting
│   └── clock/
│       ├── clock.port.ts                      # Shared clock port interface
│       └── system-clock.adapter.ts            # System clock implementation
│
├── config/
│   └── typeorm.config.ts                      # Env-aware TypeORM config (dev/prod)
│
├── db/
│   ├── datasource.ts                          # Standalone DataSource for CLI migrations
│   └── migrations/                            # All TypeORM migration files
│       └── 1710720000000-CreateBackupLogTable.ts
│
├── app/
│   └── app.module.ts                          # Root module — imports all domain modules
├── main.ts                                    # HTTP entry point
└── cli.ts                                     # CLI entry point

scripts/                                       # Host-side ONLY
├── backupctl-manage.sh                        # setup, check, deploy, update, logs, shell
└── dev.sh                                     # Dev environment: up, down, cli, test, lint, migrations
```

### Path Aliases

```
@domain/*   → src/domain/*
@common/*   → src/common/*
```

### Dependency Flow

```
presenters/ ──→ infrastructure/ ──→ application/ ──→ domain/
```

Each layer can only import from the layer(s) to its right. `common/` is imported by any layer.

### Layer Rules (within each module)

- **`domain/`** — Pure TypeScript. ZERO framework imports. Models, value objects, policies, domain errors.
- **`application/`** — Ports (outbound interfaces), use cases (orchestration), registries. Imports only its own `domain/` and other modules' `application/ports/`.
- **`infrastructure/`** — Implements ports with real adapters (DB, shell, HTTP). Imports `application/ports/` + external libs.
- **`presenters/`** — Driving adapters: CLI commands (`cli/`) and HTTP controllers (`http/`). Imports `application/use-cases/`.
- **`common/`** — Cross-cutting utilities and DI tokens. Imported by any layer of any module.

### Cross-Module Imports

Modules may only import another module's **`application/ports/`** or **`domain/`** — never its `infrastructure/` or `presenters/`.

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Vertical-slice modules (`backup/`, `audit/`, `config/`, `notification/`, `health/`) | Each module self-contained with own domain/application/infrastructure/presenters |
| Use cases in `application/use-cases/{action}/` | One directory per use case with Command/Query + UseCase. Single `execute()` method per use case |
| Command/Query pattern | Commands for writes, Queries for reads. Plain data carriers with constructor params. Presenters map args → Command/Query → UseCase.execute() |
| Ports in `application/ports/` (not `domain/`) | Ports define outbound contracts; application layer owns the orchestration interface |
| `DumperRegistry` + `NotifierRegistry` | Dynamic adapter resolution by project config type |
| `BackupLockPort` — file-based `.lock` | Survives crashes, visible on disk, cleaned on startup recovery |
| `AuditLogPort` — `startRun`/`trackProgress`/`finishRun` | Real-time progress visibility + crash detection via orphaned records |
| `FallbackWriterPort` — JSONL format | Append-only, replayed on startup. Backup success never lost to infra failure |
| TypeORM entities as `*.record.ts` | Infrastructure concern, named "record" not "entity" to avoid DDD confusion |
| `common/` over `shared/` | Cross-cutting utilities, DI tokens, shared clock port — imported by any module |
| `presenters/` layer | CLI commands and HTTP controllers as driving adapters, separate from infrastructure |
| `ClockPort` in `common/clock/` | Shared across modules, not owned by any single domain |
| Compression always on | No toggle. Each dumper uses best method per DB type |
| Schema-driven TypeORM migrations | No `synchronize`, no `migrationsRun`. Modify `*.record.ts` first → `migrate:generate` → review → `migrate:run`. Use `migrate:create` only for data migrations or custom SQL |
| Infrastructure mappers (`mappers/`) | Record ↔ Domain translation in dedicated mapper classes, keeping repositories clean |
| Winston with log rotation | JSON for prod, pretty for dev. `winston-daily-rotate-file` |
| CLI exit codes 0-5 | 0=success, 1=failure, 2=locked, 3=config error, 4=connectivity, 5=partial |
| `BACKUP_BASE_DIR` env var | Configurable base dir, default `/data/backups` |
| `TIMEZONE` env var | Default `Europe/Berlin`. Used in file names, audit, notifications, logs |
| Webhook JSON + markdown | `{ event, project, text (markdown), data (structured) }` |
| `smtp_secure` field | Explicit TLS control for email notifier |

### Config Resolution Order

1. Project YAML > `.env` global > hardcoded defaults
2. `${VAR_NAME}` in YAML resolved from `.env` at load time
3. Secrets always in `.env`, referenced via `${}` in YAML
4. Missing `notification` → global `NOTIFICATION_TYPE` + config from `.env`
5. Missing `encryption` → global `ENCRYPTION_ENABLED` / `ENCRYPTION_TYPE` / `GPG_RECIPIENT`
6. Missing `restic.password` → global `RESTIC_PASSWORD`
7. `compression.enabled` defaults to `true` (always compress)
8. Config changes require explicit `backupctl config reload` — no hot-reload

## Tech Stack

| Component      | Technology                          |
|----------------|-------------------------------------|
| Runtime        | Node.js 20 LTS                      |
| Framework      | NestJS 11                            |
| CLI            | nest-commander                       |
| ORM            | TypeORM (explicit migrations)        |
| Audit DB       | PostgreSQL 16                        |
| Scheduler      | @nestjs/schedule                     |
| Config         | @nestjs/config + js-yaml             |
| Logging        | Winston (nest-winston) with rotation |
| Testing        | Jest                                 |
| Container      | Docker + Docker Compose              |
| Remote storage | Restic → Hetzner Storage Box (SFTP)  |
| Encryption     | GPG                                  |

## Development Commands

```bash
# Build
npm run build

# Run service
npm run start:dev              # HTTP server (dev)
npm run start:prod             # HTTP server (prod)

# Run CLI
npx ts-node src/cli.ts <command>           # dev
node dist/cli.js <command>                 # prod

# Test
npm test                       # all tests
npm test -- --watch            # watch mode
npm test -- --coverage         # with coverage
npm run test:e2e               # integration tests

# Lint & format
npm run lint
npm run format

# Docker (via host scripts)
scripts/backupctl-manage.sh deploy           # build + start
scripts/backupctl-manage.sh deploy --rebuild # rebuild + restart
scripts/backupctl-manage.sh setup            # interactive first-time setup
scripts/backupctl-manage.sh check            # validate prerequisites

# Inside container
docker exec backupctl node dist/cli.js health
docker exec backupctl node dist/cli.js run locaboo --dry-run

# Migrations
scripts/dev.sh migrate:run                    # run pending
scripts/dev.sh migrate:show                   # check status
scripts/dev.sh migrate:generate <Name>        # from entity diff
scripts/dev.sh migrate:create <Name>          # empty migration
scripts/dev.sh migrate:revert                 # undo last
```

## Testing

TDD approach — write tests first, then implementation.

### Test Structure

Tests mirror the `src/` vertical-slice layout:

```
test/
├── unit/
│   ├── shared/                         # child-process util, format util
│   ├── domain/
│   │   ├── backup/models/              # Value object validation, accessors
│   │   ├── backup/policies/            # Retry policy pure function
│   │   └── config/models/              # ProjectConfig, RetentionPolicy
│   ├── application/
│   │   ├── backup/                     # RunBackupUseCase (flow, lock, dry-run, retry, fallback, timeout)
│   │   ├── backup/registries/          # DumperRegistry, NotifierRegistry
│   │   ├── audit/                      # QueryAuditLogsUseCase, RecoverStartupUseCase
│   │   ├── health/                     # CheckHealthUseCase
│   │   └── snapshot/                   # ListSnapshotsUseCase
│   └── infrastructure/
│       ├── adapters/                   # dumpers, storage, notifiers, encryptors, cleanup, hooks, clock, config
│       ├── persistence/                # TypeORM audit repo, JSONL fallback, file lock
│       ├── cli/commands/               # Command parsing, exit codes, flags
│       ├── http/                       # Controller responses
│       └── scheduler/                  # Cron registration with lock
└── integration/
    ├── config/                         # Full YAML + .env end-to-end
    ├── audit/                          # TypeORM CRUD + migrations
    ├── flow/                           # Full backup flow
    └── cli/                            # End-to-end CLI via CommandTestFactory
```

### What to Test

- **Domain models:** Validation, accessors (`hasEncryption()`, `hasTimeout()`)
- **Domain policies:** Retry — retryable/non-retryable stages, exponential backoff
- **Use cases:** RunBackupUseCase (11-step flow, lock, dry-run, retry, fallback, timeout), ListSnapshotsUseCase, ManageCacheUseCase
- **Startup recovery:** RecoverStartupUseCase — orphan marking, fallback replay, restic unlock, GPG import
- **Registries:** Register, resolve, resolve-unknown-throws
- **Adapters:** Command construction, output parsing, tagging, TLS, markdown payload
- **Persistence:** Insert+update audit, JSONL append/read/clear, .lock create/check/remove
- **CLI:** Arg parsing, exit codes (0-5), --dry-run, --only, --decompress, --guide, --clear
- **Do NOT test:** NestJS module wiring, simple getters/setters, library plumbing

### Mocking Strategy

- Mock `child_process.execFile` for shell-out adapters (dumpers, restic, gpg, hooks)
- Mock `fs` for cleanup, fallback writer, file lock adapters
- Mock `axios` for Slack/webhook notifiers
- Mock `nodemailer` for email notifier
- Mock TypeORM repository for audit repository
- All outbound ports mocked in use case tests via DI tokens
- `ClockPort` mock for deterministic timestamps

## Naming Conventions

### Files & Folders

- **Files**: `kebab-case` + type suffix: `run-backup.use-case.ts`, `backup-result.model.ts`, `database-dumper.port.ts`
- **Folders**: `kebab-case`: `use-cases/`, `value-objects/`, `run-backup/`
- **Type suffixes**: `.use-case.ts`, `.command.ts` (CQRS write), `.query.ts` (CQRS read), `.port.ts`, `.model.ts`, `.enum.ts`, `.adapter.ts`, `.repository.ts`, `.record.ts`, `.controller.ts`, `.module.ts`, `.service.ts`, `.registry.ts`, `.policy.ts`

### Classes

- **PascalCase + Type suffix**: `RunBackupUseCase`, `DatabaseDumperPort`, `BackupResult`, `BackupStage`, `TypeormAuditLogRepository`, `BackupLogRecord`
- **Use cases**: `{Action}{Entity}UseCase` — e.g. `RunBackupUseCase`, `GetBackupStatusUseCase`, `CheckHealthUseCase`
- **Commands**: `{Action}{Entity}Command` — e.g. `RunBackupCommand`, `RestoreBackupCommand`, `ClearCacheCommand`
- **Queries**: `{Action}{Entity}Query` — e.g. `ListSnapshotsQuery`, `GetBackupStatusQuery`, `GetCacheInfoQuery`
- **Ports**: `{Entity}{Action}Port` — e.g. `DatabaseDumperPort`, `AuditLogPort`, `ConfigLoaderPort`
- **Adapters**: `{Technology}{Entity}Adapter` — e.g. `PostgresDumpAdapter`, `SlackNotifierAdapter`, `GpgEncryptorAdapter`

### Command/Query Pattern (CQRS)

Each use case that accepts user input follows the Command/Query pattern:

```
Presenter (CLI/HTTP) → map args → Command/Query → UseCase.execute(command)
```

- **Commands** (write operations): `{action}.command.ts` — plain data carrier, constructor with params object
- **Queries** (read operations): `{action}.query.ts` — plain data carrier, constructor with params object
- **Use cases**: single `execute(command/query)` method per class
- **Validation**: happens at the presenter boundary (CLI arg parsing / HTTP DTO with class-validator), NOT in Commands/Queries
- **No user input**: use cases like `RecoverStartupUseCase` and `CheckHealthUseCase` skip the pattern
- **Repositories**: `{Technology}{Entity}Repository` — e.g. `TypeormAuditLogRepository`
- **Records** (TypeORM entities): `{Entity}Record` — e.g. `BackupLogRecord`
- **Commands** (CLI): `{Action}Command` — e.g. `RunCommand`, `HealthCommand`, `ConfigCommand`

### Key Renames from Previous Structure

| Old Name | New Name | New Path |
|----------|----------|----------|
| `BackupOrchestratorService` | `RunBackupUseCase` | `domain/backup/application/use-cases/run-backup/` |
| (extracted from above) | `RestoreBackupUseCase` | `domain/backup/application/use-cases/restore-backup/` |
| (extracted from above) | `GetRestoreGuideUseCase` | `domain/backup/application/use-cases/get-restore-guide/` |
| (extracted from above) | `PruneBackupUseCase` | `domain/backup/application/use-cases/prune-backup/` |
| `CacheManagementService` | `GetCacheInfoUseCase` | `domain/backup/application/use-cases/get-cache-info/` |
| (extracted from above) | `ClearCacheUseCase` | `domain/backup/application/use-cases/clear-cache/` |
| `SnapshotManagementService` | `ListSnapshotsUseCase` | `domain/backup/application/use-cases/list-snapshots/` |
| `AuditQueryService` | `GetBackupStatusUseCase` | `domain/audit/application/use-cases/get-backup-status/` |
| (extracted from above) | `GetFailedLogsUseCase` | `domain/audit/application/use-cases/get-failed-logs/` |
| `StartupRecoveryService` | `RecoverStartupUseCase` | `domain/audit/application/use-cases/recover-startup/` |
| `HealthCheckService` | `CheckHealthUseCase` | `domain/health/application/use-cases/check-health/` |
| `BackupLogEntity` | `BackupLogRecord` | `domain/audit/infrastructure/persistence/typeorm/schema/` |
| `TypeormAuditLogAdapter` | `TypeormAuditLogRepository` | `domain/audit/infrastructure/persistence/typeorm/` |

## Coding Conventions

### TypeScript / NestJS

- Prefer early return over nested `if/else`
- No `any` types — use `unknown` if needed
- No ambiguous abbreviations (`acc`, `obj`, `val`, `arr`, `tmp`, `res`, `data`)
- Use intent-revealing names (`projectConfig`, `dumpFilePath`, `retentionDays`)
- Booleans: `is`, `has`, `can`, `should` prefix
- Collections: plural nouns with explicit loop variables

### Comments (Laravel-style section headers)

```ts
// Resolve project configuration
// Acquire per-project backup lock
// Execute pre-backup hook
// Dump database
```

Explain **why**, not obvious **what**. No comments on self-evident code.

### Error Handling

- **`BackupStageError`** — typed domain error: `stage`, `originalError`, `isRetryable`
- Retryable stages: `Dump`, `Verify`, `Encrypt`, `Sync`, `Prune`, `Cleanup` (steps 3-8)
- Non-retryable: `PreHook`, `PostHook`, `Audit`, `Notify`
- **Audit/notification failure:** write to `FallbackWriterPort`, NOT a backup failure
- Never swallow errors silently

### Shell Command Execution

- Always `child_process.execFile` (not `exec`) — no shell injection
- Set timeouts on all external commands
- Capture both stdout and stderr

## Concurrency Model

- **Per-project file-based lock** (`{BACKUP_BASE_DIR}/{project}/.lock`)
- **Cron overlap:** queues behind running backup
- **CLI collision:** rejects with exit code `2`
- **`run --all`:** sequential, continues on individual failure (exit code `5` if partial)

## Backup Flow (11 Steps)

```
 0. BackupLockPort.acquire()
 0b. AuditLogPort.startRun() → returns runId
 1. NotifierPort.notifyStarted()
 2. HookExecutorPort.execute(preBackup)           — if configured
 3. DatabaseDumperPort.dump()                     ─┐
 4. DatabaseDumperPort.verify()                    │ retryable
 5. DumpEncryptorPort.encrypt()    — if enabled    │ (evaluateRetry)
 6. RemoteStoragePort.sync(paths, {tags, mode})    │
 7. RemoteStoragePort.prune()                      │
 8. LocalCleanupPort.cleanup()                    ─┘
 9. HookExecutorPort.execute(postBackup)           — if configured
10. AuditLogPort.finishRun(runId, result)           — fallback to JSONL if DB down
11. NotifierPort.notifySuccess/Failure()            — fallback to JSONL if fails
12. BackupLockPort.release()                        — always, even on failure
```

- `AuditLogPort.trackProgress(runId, stage)` at each step
- Timeout: `notifyWarning()` if `config.timeoutMinutes` exceeded (don't kill)
- Missing asset paths: skipped with warning, backup continues

## Startup Recovery

`RecoverStartupUseCase` on `onModuleInit`:
1. Mark orphaned `started` records as `failed`
2. Clean orphaned dump files
3. Remove stale `.lock` files
4. Auto-unlock restic repos
5. Replay JSONL fallback entries
6. Auto-import GPG keys from `GPG_KEYS_DIR`

## CLI Commands

14 commands via `backupctl <command>`:

| Command | Description |
|---------|-------------|
| `run <project> [--all] [--dry-run]` | Trigger backup or simulate |
| `status [project] [--last n]` | Backup status (shows current_stage) |
| `health` | Audit DB, restic repos, disk (`HEALTH_DISK_MIN_FREE_GB`), SSH |
| `restore <project> <snap> <path> [--only db/assets] [--decompress] [--guide]` | Restore + guidance |
| `snapshots <project> [--last n]` | List snapshots with tags |
| `prune <project> / --all` | Manual restic prune |
| `logs <project> [--last n] [--failed]` | Audit log queries |
| `config validate / show / reload / import-gpg-key <file>` | Config management |
| `cache <project> [--clear] / --clear-all` | Restic cache management |
| `restic <project> <cmd> [args...]` | Restic passthrough |

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General failure |
| `2` | Backup already in progress (lock held) |
| `3` | Configuration validation error |
| `4` | Connectivity error (DB, SSH, restic) |
| `5` | Partial success (`run --all`: some succeeded, some failed) |

## Docker

Two containers via `docker-compose.yml`:
- `backupctl` — Node.js 20 Alpine + database clients + restic + GPG
- `backupctl-audit-db` — PostgreSQL 16 Alpine

Volumes: `${BACKUP_BASE_DIR}`, `./config:ro`, `./ssh-keys:ro`, `./gpg-keys:ro`, asset paths

Host scripts: `scripts/backupctl-manage.sh` (prod), `scripts/dev.sh` (dev)

## Files to Never Commit

- `.env` (secrets)
- `ssh-keys/` (SSH private keys)
- `gpg-keys/`
- `node_modules/`, `dist/`
- `*.sql.gz`, `*.gpg` (backup artifacts)
- `*.lock` (backup lock files)
