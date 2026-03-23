# Architecture & Naming Conventions

## Overview

backupctl follows **hexagonal architecture** (Ports & Adapters) with **vertical-slice** module organization. Each domain module is fully self-contained — it owns its own `domain/`, `application/`, `infrastructure/`, and `presenters/` layers. No module leaks internals to another.

The core principle: **business logic never depends on infrastructure**. The domain defines _ports_ (outbound interfaces), and the infrastructure provides _adapters_ (implementations). Presenters (CLI, HTTP) are _driving_ adapters that call into the application layer.

---

## Dependency Flow

```
presenters/ ──→ application/ ──→ domain/
                     ↑
              infrastructure/
```

Each layer imports **only from the layers to its right**. `common/` is the sole exception — imported by any layer.

| Layer | Can import from | Never imports from |
|-------|----------------|--------------------|
| `domain/` | Nothing (pure TS) | `application/`, `infrastructure/`, `presenters/` |
| `application/` | Own `domain/`, other modules' `application/ports/` | `infrastructure/`, `presenters/` |
| `infrastructure/` | `application/ports/`, `domain/`, external libs | `presenters/` |
| `presenters/` | `application/use-cases/`, `domain/` | `infrastructure/` |
| `common/` | Nothing (self-contained utilities) | — |

### Cross-Module Imports

Modules may only import another module's **`application/ports/`** or **`domain/`** — never its `infrastructure/` or `presenters/`.

---

## Project Structure

```
src/
├── domain/                                    # All domain modules (vertical slices)
│   ├── backup/                                # Core backup module
│   │   ├── domain/                            # Pure TS — ZERO framework imports
│   │   │   ├── backup-result.model.ts
│   │   │   ├── backup-stage-error.ts
│   │   │   ├── value-objects/
│   │   │   │   ├── backup-stage.enum.ts
│   │   │   │   ├── backup-status.enum.ts
│   │   │   │   ├── dump-result.model.ts
│   │   │   │   ├── sync-result.model.ts
│   │   │   │   ├── prune-result.model.ts
│   │   │   │   ├── cleanup-result.model.ts
│   │   │   │   ├── cache-info.model.ts
│   │   │   │   └── snapshot-info.model.ts
│   │   │   └── policies/
│   │   │       └── retry.policy.ts            # Pure function — no framework
│   │   ├── application/
│   │   │   ├── ports/                         # Outbound interfaces
│   │   │   │   ├── database-dumper.port.ts
│   │   │   │   ├── remote-storage.port.ts
│   │   │   │   ├── remote-storage-factory.port.ts
│   │   │   │   ├── dump-encryptor.port.ts
│   │   │   │   ├── local-cleanup.port.ts
│   │   │   │   ├── hook-executor.port.ts
│   │   │   │   ├── heartbeat-monitor.port.ts
│   │   │   │   └── backup-lock.port.ts
│   │   │   ├── use-cases/                     # One dir per action
│   │   │   │   ├── run-backup/
│   │   │   │   │   ├── run-backup.command.ts
│   │   │   │   │   └── run-backup.use-case.ts
│   │   │   │   ├── restore-backup/
│   │   │   │   ├── prune-backup/
│   │   │   │   ├── list-snapshots/
│   │   │   │   ├── get-cache-info/
│   │   │   │   ├── get-restore-guide/
│   │   │   │   └── clear-cache/
│   │   │   └── registries/
│   │   │       ├── dumper.registry.ts
│   │   │       └── notifier.registry.ts
│   │   ├── infrastructure/
│   │   │   ├── adapters/
│   │   │   │   ├── dumpers/                   # postgres, mysql, mongo
│   │   │   │   ├── storage/                   # restic + factory
│   │   │   │   ├── encryptors/                # gpg
│   │   │   │   ├── cleanup/                   # file cleanup
│   │   │   │   ├── hooks/                     # shell hooks
│   │   │   │   ├── monitors/                  # uptime-kuma heartbeat
│   │   │   │   └── lock/                      # file-based .lock
│   │   │   └── scheduler/
│   │   │       └── dynamic-scheduler.service.ts
│   │   ├── presenters/
│   │   │   └── cli/
│   │   │       ├── run.command.ts
│   │   │       ├── restore.command.ts
│   │   │       ├── snapshots.command.ts
│   │   │       ├── prune.command.ts
│   │   │       ├── cache.command.ts
│   │   │       └── restic.command.ts
│   │   └── backup.module.ts
│   │
│   ├── audit/                                 # Audit trail module
│   │   ├── domain/
│   │   │   └── health-check-result.model.ts
│   │   ├── application/
│   │   │   ├── ports/
│   │   │   │   ├── audit-log.port.ts
│   │   │   │   └── fallback-writer.port.ts
│   │   │   └── use-cases/
│   │   │       ├── get-backup-status/
│   │   │       ├── get-failed-logs/
│   │   │       └── recover-startup/
│   │   ├── infrastructure/
│   │   │   └── persistence/
│   │   │       ├── typeorm/
│   │   │       │   ├── schema/
│   │   │       │   │   └── backup-log.record.ts
│   │   │       │   ├── mappers/
│   │   │       │   │   └── backup-log.mapper.ts
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
│   ├── config/                                # Configuration module
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
│   │   │   ├── webhook-notifier.adapter.ts
│   │   │   └── notifier-bootstrap.service.ts
│   │   └── notification.module.ts
│   │
│   └── health/                                # Health check module
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
│   │   └── injection-tokens.ts                # All Symbol-based DI tokens
│   ├── clock/
│   │   ├── clock.port.ts
│   │   └── system-clock.adapter.ts
│   ├── helpers/
│   │   ├── child-process.util.ts              # Safe execFile wrapper
│   │   ├── format.util.ts                     # Byte/duration formatting
│   │   └── dev-banner.util.ts                 # Dev startup banner
│   └── shared-infra.module.ts                 # Global providers (clock, lock, storage)
│
├── config/
│   └── typeorm.config.ts                      # Env-aware TypeORM config
│
├── db/
│   ├── datasource.ts                          # Standalone DataSource for CLI
│   └── migrations/                            # All TypeORM migrations
│
├── app/
│   └── app.module.ts                          # Root module
├── main.ts                                    # HTTP entry point
└── cli.ts                                     # CLI entry point
```

### Path Aliases

```
@domain/*  → src/domain/*
@common/*  → src/common/*
```

---

## Layer Rules

### `domain/` — Pure TypeScript

Zero framework imports. No `@nestjs/*`, no `typeorm`, no decorators. Contains:

- **Models** — immutable value objects with readonly fields and constructor params
- **Value objects** — enums, small typed data carriers (`DumpResult`, `SyncResult`)
- **Policies** — pure functions encoding business rules (`evaluateRetry`)
- **Errors** — typed domain errors (`BackupStageError`)

Domain models use `has*()` accessor methods for feature checks:

```typescript
projectConfig.hasEncryption()
projectConfig.hasTimeout()
projectConfig.hasHooks()
```

### `application/` — Orchestration

Contains **use cases**, **ports** (outbound interfaces), and **registries** (dynamic adapter resolution).

- **Use cases** have a single `execute(command|query)` method
- **Commands** are for write operations, **Queries** for reads — both are plain data carriers
- **Ports** define what external capabilities the module needs
- **Registries** resolve the correct adapter at runtime by type key

### `infrastructure/` — Adapters

Implements ports with real tools. Split into:

- **`adapters/`** — outbound adapters (shell commands, APIs, file system)
- **`persistence/`** — database access (TypeORM repository, JSONL fallback, file lock)
- **`scheduler/`** — dynamic cron registration

**TypeORM infrastructure follows the schema/mapper/repository pattern:**

```
infrastructure/persistence/typeorm/
├── schema/
│   └── backup-log.record.ts        # TypeORM entity (DB shape)
├── mappers/
│   └── backup-log.mapper.ts        # Record ↔ Domain translation
└── typeorm-audit-log.repository.ts  # Clean repository (query + persist)
```

- **Record** (`*.record.ts`) — pure TypeORM entity with decorators. Maps 1:1 to the database table. The source of truth for schema — migrations are generated from record changes.
- **Mapper** (`*.mapper.ts`) — `@Injectable()` service with `toDomain(record)` and `toPartialRecord(domainModel)`. Handles type conversions (`bigint` ↔ `number`, `string` ↔ `enum`).
- **Repository** — injects the TypeORM `Repository<Record>` and the mapper. Only does querying and persisting — no inline mapping logic.

### `presenters/` — Driving Adapters

Inbound adapters that accept user input and call use cases:

- **`cli/`** — nest-commander commands. Map CLI args → Command/Query → UseCase.execute()
- **`http/`** — NestJS controllers. Map HTTP request → UseCase.execute() → response

Presenters are thin — no business logic, only argument parsing and response formatting.

---

## Module Wiring

```
AppModule (root)
├── ConfigModule.forRoot({ load: [typeormConfig] })
├── TypeOrmModule.forRootAsync()       via ConfigService.get('typeorm')
├── ScheduleModule.forRoot()
├── WinstonModule.forRootAsync()
│
├── SharedInfraModule  [@Global]
│   ├── CLOCK_PORT         → SystemClockAdapter
│   ├── BACKUP_LOCK_PORT   → FileBackupLockAdapter
│   └── REMOTE_STORAGE_FACTORY → ResticStorageFactory
│
├── ConfigAppModule    [@Global]
│   └── CONFIG_LOADER_PORT → YamlConfigLoaderAdapter
│
├── AuditModule
│   ├── AUDIT_LOG_PORT     → TypeormAuditLogRepository
│   ├── FALLBACK_WRITER_PORT → JsonlFallbackWriterAdapter
│   └── BackupLogMapper
│
├── BackupModule       [imports AuditModule]
│   ├── DUMP_ENCRYPTOR_PORT  → GpgEncryptorAdapter
│   ├── LOCAL_CLEANUP_PORT   → FileCleanupAdapter
│   ├── HOOK_EXECUTOR_PORT   → ShellHookExecutorAdapter
│   ├── DUMPER_REGISTRY      → DumperRegistry
│   └── NOTIFIER_REGISTRY    → NotifierRegistry
│
├── NotificationModule
│   └── NotifierBootstrapService (registers adapters at startup)
│
└── HealthModule       [imports AuditModule]
```

All DI tokens are **Symbol-based**, defined in `common/di/injection-tokens.ts`.

---

## Dependency Injection

### Symbol Tokens

Every port binding uses a Symbol token, never a class reference:

```typescript
// common/di/injection-tokens.ts
export const DATABASE_DUMPER_PORT = Symbol('DATABASE_DUMPER_PORT');
export const AUDIT_LOG_PORT = Symbol('AUDIT_LOG_PORT');
// ...

// Module binding
{ provide: AUDIT_LOG_PORT, useClass: TypeormAuditLogRepository }

// Use case injection
constructor(@Inject(AUDIT_LOG_PORT) private readonly auditLog: AuditLogPort) {}
```

### Registries

`DumperRegistry` and `NotifierRegistry` resolve adapters **dynamically** at runtime by type key:

```typescript
const dumper = dumperRegistry.resolve(projectConfig.database.type);  // 'postgres' → PostgresDumpAdapter
const notifier = notifierRegistry.resolve(notificationConfig.type);  // 'slack' → SlackNotifierAdapter
```

---

## Domain Modules

### backup/ — Core Backup Module

The main module. Orchestrates the 11-step backup flow.

**Ports:**

| Port | Methods |
|------|---------|
| `DatabaseDumperPort` | `dump()`, `verify()` |
| `RemoteStoragePort` | `sync()`, `prune()`, `listSnapshots()`, `restore()`, `exec()`, `getCacheInfo()`, `clearCache()`, `unlock()` |
| `RemoteStorageFactory` | `create(config)` → `RemoteStoragePort` |
| `DumpEncryptorPort` | `encrypt()`, `decrypt()` |
| `LocalCleanupPort` | `cleanup()` |
| `HookExecutorPort` | `execute()` |
| `BackupLockPort` | `acquire()`, `acquireOrQueue()`, `release()`, `isLocked()` |

**Use Cases:**

| Use Case | Input | Output |
|----------|-------|--------|
| `RunBackupUseCase` | `RunBackupCommand` | `BackupResult[]` |
| `RestoreBackupUseCase` | `RestoreBackupCommand` | `void` |
| `PruneBackupUseCase` | `PruneBackupCommand` | `PruneResult[]` |
| `ListSnapshotsUseCase` | `ListSnapshotsQuery` | `SnapshotInfo[]` |
| `GetCacheInfoUseCase` | `GetCacheInfoQuery` | `CacheInfo` |
| `ClearCacheUseCase` | `ClearCacheCommand` | `void` |
| `GetRestoreGuideUseCase` | `GetRestoreGuideQuery` | `string` |

**Adapters:**

| Adapter | Implements | External Tool |
|---------|------------|---------------|
| `PostgresDumpAdapter` | `DatabaseDumperPort` | `pg_dump` / `pg_restore` |
| `MysqlDumpAdapter` | `DatabaseDumperPort` | `mysqldump` |
| `MongoDumpAdapter` | `DatabaseDumperPort` | `mongodump` |
| `ResticStorageAdapter` | `RemoteStoragePort` | `restic` CLI |
| `ResticStorageFactory` | `RemoteStorageFactory` | creates configured `ResticStorageAdapter` |
| `GpgEncryptorAdapter` | `DumpEncryptorPort` | `gpg` CLI |
| `FileCleanupAdapter` | `LocalCleanupPort` | Node.js `fs` |
| `ShellHookExecutorAdapter` | `HookExecutorPort` | `child_process.execFile` |
| `FileBackupLockAdapter` | `BackupLockPort` | Node.js `fs` (`.lock` files) |
| `UptimeKumaHeartbeatAdapter` | `HeartbeatMonitorPort` | Uptime Kuma Push API (HTTP) |

### audit/ — Audit Trail Module

Tracks every backup run with real-time stage progress.

**Ports:**

| Port | Methods |
|------|---------|
| `AuditLogPort` | `startRun()`, `trackProgress()`, `finishRun()`, `findByProject()`, `findFailed()`, `findSince()`, `findOrphaned()` |
| `FallbackWriterPort` | `writeAuditFallback()`, `writeNotificationFallback()`, `readPendingEntries()`, `clearReplayed()` |

**Use Cases:**

| Use Case | Purpose |
|----------|---------|
| `GetBackupStatusUseCase` | Query backup history per project |
| `GetFailedLogsUseCase` | Query failed backup logs |
| `RecoverStartupUseCase` | Crash recovery on boot (orphan marking, lock cleanup, fallback replay, restic unlock, GPG import) |

### config/ — Configuration Module

**Port:** `ConfigLoaderPort` — `loadAll()`, `getProject()`, `validate()`, `reload()`

**Models:** `ProjectConfig` (immutable, with `has*()` accessors), `RetentionPolicy`

### notification/ — Notification Module

**Port:** `NotifierPort` — `notifyStarted()`, `notifySuccess()`, `notifyFailure()`, `notifyWarning()`, `notifyDailySummary()`

**Adapters:** `SlackNotifierAdapter`, `EmailNotifierAdapter`, `WebhookNotifierAdapter`

### health/ — Health Check Module

**Use Case:** `CheckHealthUseCase` — checks audit DB, disk space, SSH, restic repos, Uptime Kuma connectivity

---

## Error Handling

### BackupStageError

The primary domain error. Carries:

- `stage` — which backup step failed (typed `BackupStage` enum)
- `originalError` — the underlying error
- `isRetryable` — whether this stage supports retry

### Retryable vs Non-Retryable Stages

| Retryable (steps 3–8) | Non-Retryable |
|------------------------|---------------|
| Dump, Verify, Encrypt, Sync, Prune, Cleanup | PreHook, PostHook, Audit, Notify |

The retry policy (`evaluateRetry`) is a **pure function** with exponential backoff.

### Failure Isolation

Audit and notification failures are **never** backup failures. If `AuditLogPort.finishRun()` fails, the result is written to `FallbackWriterPort`. The backup is still reported as successful.

### Shell Command Safety

All external commands use `child_process.execFile` (never `exec`) with timeouts. No shell injection.

---

## Naming Conventions

### Files & Folders

All **kebab-case**. Files include a type suffix:

| Suffix | Layer | Purpose | Example |
|--------|-------|---------|---------|
| `.model.ts` | domain | Immutable value object | `backup-result.model.ts` |
| `.enum.ts` | domain | Enumeration | `backup-stage.enum.ts` |
| `.policy.ts` | domain | Pure business rule function | `retry.policy.ts` |
| `.port.ts` | application | Outbound interface | `database-dumper.port.ts` |
| `.use-case.ts` | application | Use case orchestration | `run-backup.use-case.ts` |
| `.command.ts` | application | CQRS write input | `run-backup.command.ts` |
| `.query.ts` | application | CQRS read input | `list-snapshots.query.ts` |
| `.registry.ts` | application | Dynamic adapter resolver | `dumper.registry.ts` |
| `.adapter.ts` | infrastructure | Port implementation | `postgres-dump.adapter.ts` |
| `.record.ts` | infrastructure | TypeORM entity (DB shape) | `backup-log.record.ts` |
| `.mapper.ts` | infrastructure | Record ↔ Domain translation | `backup-log.mapper.ts` |
| `.repository.ts` | infrastructure | Database access | `typeorm-audit-log.repository.ts` |
| `.service.ts` | infrastructure | Infrastructure service | `dynamic-scheduler.service.ts` |
| `.command.ts` | presenters/cli | nest-commander CLI command | `run.command.ts` |
| `.controller.ts` | presenters/http | NestJS HTTP controller | `health.controller.ts` |
| `.module.ts` | any | NestJS module barrel | `backup.module.ts` |

### Classes

All **PascalCase** with type suffix matching the file suffix:

| Pattern | Example |
|---------|---------|
| `{Action}{Entity}UseCase` | `RunBackupUseCase`, `GetBackupStatusUseCase` |
| `{Action}{Entity}Command` | `RunBackupCommand`, `ClearCacheCommand` |
| `{Action}{Entity}Query` | `ListSnapshotsQuery`, `GetCacheInfoQuery` |
| `{Entity}{Action}Port` | `DatabaseDumperPort`, `AuditLogPort` |
| `{Technology}{Entity}Adapter` | `PostgresDumpAdapter`, `SlackNotifierAdapter` |
| `{Technology}{Entity}Repository` | `TypeormAuditLogRepository` |
| `{Entity}Record` | `BackupLogRecord` |
| `{Entity}Mapper` | `BackupLogMapper` |
| `{Entity}Registry` | `DumperRegistry`, `NotifierRegistry` |
| `{Entity}Result` | `BackupResult`, `DumpResult`, `SyncResult` |
| `{Entity}Config` | `ProjectConfig` |
| `{Entity}Error` | `BackupStageError` |

### TypeScript Conventions

- **No `any`** — use `unknown` when the type is genuinely unknown
- **No abbreviations** — `acc`, `obj`, `val`, `arr`, `tmp`, `res`, `data` are banned. Use `projectConfig`, `dumpFilePath`, `retentionDays`
- **Boolean prefixes** — `is`, `has`, `can`, `should` (`isRetryable`, `hasEncryption`)
- **Collections** — plural nouns with explicit loop variables (`for (const project of projects)`)
- **Early return** — prefer early return over nested `if/else`
- **Readonly** — domain models use `readonly` fields with constructor params
- **No barrel exports** — import directly from the file, not from `index.ts`

### Comments (Laravel-style section headers)

```typescript
// Resolve project configuration

// Acquire per-project backup lock

// Execute pre-backup hook

// Dump database
```

Explain **why**, not obvious **what**. No comments on self-evident code.

### DI Token Naming

All SCREAMING_SNAKE_CASE with `_PORT`, `_REGISTRY`, or `_FACTORY` suffix:

```typescript
DATABASE_DUMPER_PORT
REMOTE_STORAGE_FACTORY
DUMPER_REGISTRY
```

---

## Migrations

Schema-driven. The `*.record.ts` file is the source of truth:

```
1. Modify record schema   →  *.record.ts
2. Generate migration     →  scripts/dev.sh migrate:generate <Name>
3. Review generated file  →  src/db/migrations/
4. Run migration          →  scripts/dev.sh migrate:run
5. Update mapper          →  *.mapper.ts (if needed)
```

- `migrationsRun: false` — always manual
- `synchronize: false` — always manual
- Use `migrate:create` only for data migrations or custom SQL

See [Migration Guide](14-migrations.md) for full details.

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Vertical-slice modules | Each module self-contained. No cross-module infrastructure leaks |
| Use cases with Command/Query pattern | Single `execute()` method. Presenters map args → Command/Query → UseCase |
| Ports in `application/` not `domain/` | Ports define outbound contracts; application owns the orchestration interface |
| Symbol-based DI tokens | Decouples from class references. Clean `@Inject(TOKEN)` pattern |
| Registries for dynamic resolution | Dumpers and notifiers resolved by config type at runtime |
| File-based `.lock` per project | Survives crashes, visible on disk, cleaned on startup recovery |
| Schema/Mapper/Repository pattern | Record ↔ Domain translation in dedicated mapper. Repository stays clean |
| Schema-driven migrations | Record is source of truth. `generate` diffs against DB. Never hand-write schema changes |
| `FallbackWriterPort` (JSONL) | Append-only. Backup success never lost to audit DB failure |
| `ClockPort` in `common/` | Shared across modules. Enables deterministic testing |
| `execFile` over `exec` | No shell injection. All external commands via safe wrapper |
| Compression always on | No toggle. Each dumper uses best method per DB type |
| CLI exit codes 0–5 | `0`=success, `1`=failure, `2`=locked, `3`=config, `4`=connectivity, `5`=partial |
