# Architecture

## Overview

backupctl follows **hexagonal architecture** (Ports & Adapters) with three layers and a shared utility layer:

- **Domain** — pure TypeScript business logic with zero framework dependencies
- **Application** — use case orchestration that coordinates domain ports
- **Infrastructure** — all external-facing code: adapters, persistence, CLI, HTTP, scheduler
- **Shared** — cross-cutting utilities and dependency injection tokens

The core principle is that business logic never depends on infrastructure. The domain defines _ports_ (interfaces) that describe what it needs, and the infrastructure provides _adapters_ (implementations) that fulfill those contracts. This makes the domain testable in isolation and the infrastructure swappable without touching business rules.

## Dependency Flow

```
infrastructure/ ──→ application/ ──→ domain/
```

Dependencies flow **inward only**. Infrastructure depends on application and domain. Application depends on domain. Domain depends on nothing outside itself. The shared layer is an exception — it can be imported by any layer, but contains only pure utilities and DI token definitions.

This is never reversed. Domain code never imports from `application/` or `infrastructure/`. Application code never imports from `infrastructure/`.

## Layer Rules

### Domain Layer — `src/domain/`

The domain layer is **pure TypeScript**. It has zero framework imports — no `@nestjs/*`, no `typeorm`, no decorators of any kind. It contains:

- **Ports** — interfaces that define contracts for external capabilities (database dumping, remote storage, notifications, etc.)
- **Models** — immutable value objects that represent domain concepts (project configuration, backup results, retention policies)
- **Policies** — pure functions that encode business rules (retry evaluation with exponential backoff)

The domain is organized by **subdomain**, each owning its own ports and models:

```
src/domain/
├── backup/       # Core backup subdomain
│   ├── ports/
│   ├── models/
│   └── policies/
├── audit/        # Audit trail subdomain
│   ├── ports/
│   └── models/
├── config/       # Configuration subdomain
│   ├── ports/
│   └── models/
├── notification/  # Notification subdomain
│   └── ports/
└── shared/       # Cross-domain
    └── ports/
```

Nothing in the domain knows about NestJS modules, TypeORM entities, HTTP controllers, or CLI commands. If you can't express it without importing an external library, it doesn't belong here.

### Application Layer — `src/application/`

The application layer imports **only from `domain/`**. It orchestrates use cases by coordinating domain ports:

- **BackupOrchestratorService** — drives the 11-step backup flow, calling ports in sequence with retry logic, timeout monitoring, and fallback handling
- **DumperRegistry** — resolves the correct `DatabaseDumperPort` adapter based on project config database type
- **NotifierRegistry** — resolves the correct `NotifierPort` adapter based on project config notification type
- **AuditQueryService** — queries the audit log for status and history
- **StartupRecoveryService** — crash recovery on `onModuleInit`: orphan marking, lock cleanup, fallback replay, restic unlock, GPG import
- **HealthCheckService** — validates audit DB, restic repos, disk space, SSH connectivity
- **SnapshotManagementService** — lists and manages restic snapshots
- **CacheManagementService** — manages restic cache per project

The orchestrator is an _application service_, not a domain object. It coordinates ports but contains no business rules of its own — those live in domain policies.

### Infrastructure Layer — `src/infrastructure/`

The infrastructure layer imports `domain/` (to implement ports) and external libraries. It is split into four categories:

**Adapters (driven / outbound)** — `adapters/`

Implement domain ports using external tools and libraries:

| Directory | Implements | External dependency |
|-----------|-----------|---------------------|
| `dumpers/` | `DatabaseDumperPort` | `pg_dump`, `mysqldump`, `mongodump` |
| `storage/` | `RemoteStoragePort` | `restic` CLI |
| `notifiers/` | `NotifierPort` | Axios (Slack/Webhook), Nodemailer (Email) |
| `encryptors/` | `DumpEncryptorPort` | `gpg` CLI |
| `cleanup/` | `LocalCleanupPort` | Node.js `fs` |
| `hooks/` | `HookExecutorPort` | `child_process.execFile` |
| `config/` | `ConfigLoaderPort` | `js-yaml` + `@nestjs/config` |
| `clock/` | `ClockPort` | `Date` + timezone |

**Persistence (driven / outbound)** — `persistence/`

| Directory | Implements | External dependency |
|-----------|-----------|---------------------|
| `audit/` | `AuditLogPort` | TypeORM + PostgreSQL |
| `fallback/` | `FallbackWriterPort` | Node.js `fs` (JSONL) |
| `lock/` | `BackupLockPort` | Node.js `fs` (file lock) |

**CLI (driving / inbound)** — `cli/`

14 nest-commander commands that parse arguments, call application services, and return structured exit codes (0–5).

**HTTP (driving / inbound)** — `http/`

Health and status controllers for monitoring. Minimal surface — backupctl is CLI-first.

**Scheduler (driving / inbound)** — `scheduler/`

Dynamic cron registration from project YAML configs using `@nestjs/schedule`. Acquires the per-project lock before triggering a backup run.

### Shared — `src/shared/`

Cross-cutting concerns imported by any layer:

- **`injection-tokens.ts`** — Symbol-based DI tokens for all ports
- **`child-process.util.ts`** — safe `execFile` wrapper with timeout and error handling
- **`format.util.ts`** — byte formatting, duration formatting, timestamp formatting

## Full Project Structure

```
src/
├── domain/
│   ├── backup/
│   │   ├── ports/
│   │   │   ├── database-dumper.port.ts
│   │   │   ├── remote-storage.port.ts
│   │   │   ├── dump-encryptor.port.ts
│   │   │   ├── local-cleanup.port.ts
│   │   │   ├── hook-executor.port.ts
│   │   │   └── backup-lock.port.ts
│   │   ├── models/
│   │   └── policies/
│   │       └── retry.policy.ts
│   ├── audit/
│   │   ├── ports/
│   │   │   ├── audit-log.port.ts
│   │   │   └── fallback-writer.port.ts
│   │   └── models/
│   ├── config/
│   │   ├── ports/
│   │   │   └── config-loader.port.ts
│   │   └── models/
│   │       ├── project-config.model.ts
│   │       └── retention-policy.model.ts
│   ├── notification/
│   │   └── ports/
│   │       └── notifier.port.ts
│   └── shared/
│       └── ports/
│           └── clock.port.ts
│
├── application/
│   ├── backup/
│   │   ├── backup-orchestrator.service.ts
│   │   ├── cache-management.service.ts
│   │   └── registries/
│   │       ├── dumper.registry.ts
│   │       └── notifier.registry.ts
│   ├── audit/
│   │   ├── audit-query.service.ts
│   │   └── startup-recovery.service.ts
│   ├── health/
│   │   └── health-check.service.ts
│   ├── snapshot/
│   │   └── snapshot-management.service.ts
│   └── application.module.ts
│
├── infrastructure/
│   ├── adapters/
│   │   ├── dumpers/
│   │   ├── storage/
│   │   ├── notifiers/
│   │   ├── encryptors/
│   │   ├── cleanup/
│   │   ├── hooks/
│   │   ├── config/
│   │   └── clock/
│   ├── persistence/
│   │   ├── audit/
│   │   ├── fallback/
│   │   └── lock/
│   ├── cli/
│   ├── http/
│   ├── scheduler/
│   └── infrastructure.module.ts
│
├── shared/
│   ├── injection-tokens.ts
│   ├── child-process.util.ts
│   └── format.util.ts
│
├── app.module.ts
├── main.ts
└── cli.ts
```

## Domain Subdomains

### backup/

The core subdomain. Defines ports for every external capability the backup flow needs:

| Port | Responsibility |
|------|---------------|
| `DatabaseDumperPort` | Dump and verify a database. Methods: `dump()`, `verify()` |
| `RemoteStoragePort` | Sync files to remote storage, prune old snapshots. Methods: `sync(paths, options)`, `prune()`, `unlock()` |
| `DumpEncryptorPort` | Encrypt a dump file with GPG. Methods: `encrypt()` |
| `LocalCleanupPort` | Remove local dump files after sync. Methods: `cleanup()` |
| `HookExecutorPort` | Run pre/post backup shell commands. Methods: `execute(hook)` |
| `BackupLockPort` | Per-project file-based locking. Methods: `acquire()`, `release()`, `isLocked()`, `removeStale()` |

Models include `BackupResult`, `BackupStage`, `DumpResult`, `SyncResult`, `PruneResult`, and related value objects. The `retry.policy.ts` is a pure function that evaluates whether a failed stage should be retried based on stage type and attempt count, with exponential backoff delay calculation.

### audit/

Tracks every backup run with real-time stage progress:

| Port | Responsibility |
|------|---------------|
| `AuditLogPort` | Insert a run record, update stage progress, finalize with result. Methods: `startRun()`, `trackProgress()`, `finishRun()` |
| `FallbackWriterPort` | Append-only JSONL file for when the audit DB is unavailable. Methods: `append()`, `readAll()`, `clear()` |

The insert+update pattern (`startRun` → `trackProgress` at each step → `finishRun`) provides real-time visibility into running backups and enables crash detection — any record left in "started" status after a restart is an orphan.

### config/

Loads and validates project configuration:

| Port | Responsibility |
|------|---------------|
| `ConfigLoaderPort` | Load project configs from YAML, resolve `${VAR}` references from `.env`. Methods: `loadAll()`, `loadProject()`, `reload()` |

Models include `ProjectConfig` (database connection, schedule, retention, encryption, hooks, notification, timeout) and `RetentionPolicy` (daily, weekly, monthly, yearly counts). Both are immutable value objects with accessor methods like `hasEncryption()`, `hasTimeout()`, `hasPreHook()`.

### notification/

Sends notifications across configured channels:

| Port | Responsibility |
|------|---------------|
| `NotifierPort` | Send lifecycle notifications. Methods: `notifyStarted()`, `notifySuccess()`, `notifyFailure()`, `notifyWarning()`, `notifyDailySummary()` |

The `notifyWarning(project, message)` method is a generic escape hatch for non-fatal issues like timeout warnings, missing asset paths, or low disk space.

### shared/

Cross-domain utilities:

| Port | Responsibility |
|------|---------------|
| `ClockPort` | Return the current timestamp in the configured timezone. Methods: `now()` |

The `ClockPort` abstraction enables deterministic testing — tests inject a mock clock that returns fixed timestamps instead of relying on `Date.now()`.

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Domain subdomains (`backup/`, `audit/`, `config/`, `notification/`) | Each owns its ports + models. Scales without cross-contamination. |
| Orchestrator in `application/`, not `domain/` | Coordinates ports — application service, not domain logic. |
| `DumperRegistry` + `NotifierRegistry` | Dynamic adapter resolution by project config type. |
| File-based `.lock` per project | Survives crashes, visible on disk, cleaned on startup recovery. |
| `AuditLogPort` insert+update pattern | Real-time progress visibility + crash detection via orphaned records. |
| `FallbackWriterPort` in JSONL format | Append-only, replayed on startup. Backup success is never lost to infra failure. |
| `notifyWarning(project, message)` | Generic warning method for timeouts, missing assets, disk space. |
| `RemoteStoragePort.sync(paths, options)` | Options object `{ tags, snapshotMode }` for tagging + mode. |
| `ClockPort` | Deterministic testing with injectable time. |
| Compression always on | No toggle. Each dumper uses the best compression method per DB type. |
| Explicit TypeORM migrations | No `synchronize: true`. Safe for production schema changes. |
| Winston with log rotation | JSON format for prod, pretty-print for dev. `winston-daily-rotate-file`. |
| CLI exit codes 0–5 | Standardized for scripting: 0=success, 1=failure, 2=locked, 3=config, 4=connectivity, 5=partial. |
| `BACKUP_BASE_DIR` env var | Configurable base directory, default `/data/backups`. |
| `TIMEZONE` env var | Default `Europe/Berlin`. Used in file names, audit timestamps, notifications, logs. |
| Webhook JSON + markdown | Payload: `{ event, project, text (markdown), data (structured) }`. |
| `smtp_secure` field | Explicit TLS control for the email notifier, not inferred from port. |
| `child_process.execFile` over `exec` | No shell injection. All external commands use `execFile` with timeouts. |

## Naming Conventions

### File naming

| Suffix | Layer | Purpose |
|--------|-------|---------|
| `*.port.ts` | Domain | Interface defining an external capability |
| `*.model.ts` | Domain | Immutable value object |
| `*.policy.ts` | Domain | Pure function encoding a business rule |
| `*.service.ts` | Application | Use case orchestration |
| `*.registry.ts` | Application | Dynamic adapter resolution |
| `*.adapter.ts` | Infrastructure | Concrete implementation of a domain port |
| `*.entity.ts` | Infrastructure | TypeORM database entity |
| `*.command.ts` | Infrastructure | nest-commander CLI command |
| `*.controller.ts` | Infrastructure | NestJS HTTP controller |
| `*.enum.ts` | Any | Enumeration type |

### TypeScript conventions

- **No `any`** — use `unknown` when the type is genuinely unknown
- **No abbreviations** — `acc`, `obj`, `val`, `arr`, `tmp`, `res`, `data` are all banned. Use intent-revealing names like `projectConfig`, `dumpFilePath`, `retentionDays`
- **Boolean prefixes** — `is`, `has`, `can`, `should` (e.g., `isRetryable`, `hasEncryption`)
- **Collection naming** — plural nouns with explicit loop variables (e.g., `for (const project of projects)`)
- **Early return** — prefer early return over nested `if/else` chains
- **Comments** — explain _why_, not obvious _what_. Use Laravel-style section headers:

```typescript
// Resolve project configuration

// Acquire per-project backup lock

// Execute pre-backup hook

// Dump database
```

## Error Handling

### BackupStageError

The primary domain error type. Carries three properties:

- `stage` — which step of the backup flow failed (typed enum)
- `originalError` — the underlying error
- `isRetryable` — whether this stage supports retry

### Retryable vs non-retryable stages

| Retryable (steps 3–8) | Non-retryable |
|------------------------|---------------|
| Dump | PreHook |
| Verify | PostHook |
| Encrypt | Audit |
| Sync | Notify |
| Prune | |
| Cleanup | |

The retry policy is a pure function in `domain/backup/policies/retry.policy.ts`. It takes the stage, attempt count, and max retries, and returns whether to retry and the backoff delay.

### Failure isolation

Audit and notification failures are **not** backup failures. If `AuditLogPort.finishRun()` fails, the result is written to `FallbackWriterPort` and the backup is still considered successful. If `NotifierPort.notifySuccess()` fails, the failure is logged but does not change the backup result. This ensures that infrastructure issues in secondary systems never cause a successful backup to be reported as failed.

### Shell command safety

All external commands (`pg_dump`, `restic`, `gpg`, etc.) are executed via `child_process.execFile`, never `child_process.exec`. This prevents shell injection attacks. Every command has a configurable timeout.

## Dependency Injection

All domain ports are bound to their infrastructure adapters through **Symbol-based injection tokens** defined in `src/shared/injection-tokens.ts`:

```typescript
export const DATABASE_DUMPER_PORT = Symbol('DatabaseDumperPort');
export const REMOTE_STORAGE_PORT = Symbol('RemoteStoragePort');
export const DUMP_ENCRYPTOR_PORT = Symbol('DumpEncryptorPort');
export const AUDIT_LOG_PORT = Symbol('AuditLogPort');
// ... all ports
```

The `InfrastructureModule` binds concrete adapters to these tokens. Application services receive ports via constructor injection using `@Inject(TOKEN)`. This keeps the application layer unaware of which concrete adapter is in use — it only knows the port interface.

Registries (`DumperRegistry`, `NotifierRegistry`) take this one step further by resolving adapters _dynamically_ at runtime based on the project's configured database type or notification type.

## What's Next

- **Full requirements spec** — [Requirements](03-requirements.md) lists host prerequisites and supported platforms.
- **Configuration deep dive** — [Configuration](05-configuration.md) covers the YAML format, `.env` resolution, and per-project overrides.
- **Extend backupctl** — [Adding Adapters](11-adding-adapters.md) walks through implementing a new database dumper or notification channel.
