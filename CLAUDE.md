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

Hexagonal (Ports & Adapters) with 3-layer separation: **domain**, **application**, **infrastructure**.

```
src/
├── domain/                              # Pure TypeScript — ZERO framework imports
│   ├── backup/                          # Core backup subdomain
│   │   ├── ports/
│   │   │   ├── database-dumper.port.ts
│   │   │   ├── remote-storage.port.ts
│   │   │   ├── dump-encryptor.port.ts
│   │   │   ├── local-cleanup.port.ts
│   │   │   ├── hook-executor.port.ts
│   │   │   └── backup-lock.port.ts      # file-based .lock
│   │   ├── models/                      # immutable value objects
│   │   └── policies/
│   │       └── retry.policy.ts          # pure function
│   ├── audit/                           # Audit subdomain
│   │   ├── ports/
│   │   │   ├── audit-log.port.ts        # startRun/trackProgress/finishRun
│   │   │   └── fallback-writer.port.ts  # JSONL format
│   │   └── models/
│   ├── config/                          # Config subdomain
│   │   ├── ports/
│   │   │   └── config-loader.port.ts
│   │   └── models/
│   │       ├── project-config.model.ts
│   │       └── retention-policy.model.ts
│   ├── notification/                    # Notification subdomain
│   │   └── ports/
│   │       └── notifier.port.ts         # incl. notifyWarning(project, message)
│   └── shared/                          # Cross-domain
│       └── ports/
│           └── clock.port.ts
│
├── application/                         # Use case orchestration — imports domain/ only
│   ├── backup/
│   │   ├── backup-orchestrator.service.ts
│   │   ├── cache-management.service.ts
│   │   └── registries/
│   │       ├── dumper.registry.ts       # db type → DatabaseDumperPort
│   │       └── notifier.registry.ts     # notification type → NotifierPort
│   ├── audit/
│   │   ├── audit-query.service.ts
│   │   └── startup-recovery.service.ts  # crash recovery, fallback replay, GPG, unlock
│   ├── health/
│   │   └── health-check.service.ts
│   ├── snapshot/
│   │   └── snapshot-management.service.ts
│   └── application.module.ts
│
├── infrastructure/                      # ALL external-facing code
│   ├── adapters/                        # Driven (outbound): implements domain ports
│   │   ├── dumpers/                     # postgres, mysql, mongo (always compress)
│   │   ├── storage/                     # restic + factory + tagging
│   │   ├── notifiers/                   # slack, email (smtp_secure), webhook (JSON+markdown)
│   │   ├── encryptors/                  # gpg + key manager
│   │   ├── cleanup/                     # file cleanup
│   │   ├── hooks/                       # shell hook executor
│   │   ├── config/                      # YAML loader + TIMEZONE + BACKUP_BASE_DIR
│   │   └── clock/                       # system clock
│   ├── persistence/                     # Driven (outbound): data storage
│   │   ├── audit/                       # TypeORM + migrations
│   │   ├── fallback/                    # JSONL fallback writer
│   │   └── lock/                        # file-based .lock per project
│   ├── cli/                             # Driving (inbound): 14 commands, exit codes 0-5
│   ├── http/                            # Driving (inbound): health + status controllers
│   ├── scheduler/                       # Driving (inbound): dynamic cron with lock
│   └── infrastructure.module.ts         # Barrel: binds all adapters to port tokens
│
├── shared/                              # Cross-cutting
│   ├── injection-tokens.ts              # All port DI tokens
│   ├── child-process.util.ts            # Safe execFile wrapper
│   └── format.util.ts                   # Byte/duration/timestamp formatting
│
├── app.module.ts
├── main.ts                              # HTTP entry point
└── cli.ts                               # CLI entry point

scripts/                                 # Host-side ONLY
├── deploy.sh
└── backupctl-manage.sh                  # setup, check, deploy, update, logs, shell
```

### Dependency Flow

```
infrastructure/ ──→ application/ ──→ domain/
```

### Layer Rules

- **`domain/`** imports **nothing** outside itself. No `@nestjs/*`, no `typeorm`, no decorators. Pure TypeScript. Organized by subdomain: `backup/`, `audit/`, `config/`, `notification/`, `shared/`.
- **`application/`** imports only `domain/`. Use case orchestration, registries, startup recovery.
- **`infrastructure/`** imports `domain/` (to implement ports) + external libs. Split into `adapters/` (outbound), `persistence/` (data storage), `cli/`/`http/`/`scheduler/` (inbound).
- **`shared/`** imported by any layer. Only pure utilities and DI token definitions.

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Domain subdomains (`backup/`, `audit/`, `config/`, `notification/`) | Each owns its ports + models. Scales without cross-contamination. |
| Orchestrator in `application/`, not `domain/` | Coordinates ports — application service, not domain logic |
| `DumperRegistry` + `NotifierRegistry` | Dynamic adapter resolution by project config type |
| `BackupLockPort` — file-based `.lock` | Survives crashes, visible on disk, cleaned on startup recovery |
| `AuditLogPort` — `startRun`/`trackProgress`/`finishRun` | Real-time progress visibility + crash detection via orphaned records |
| `FallbackWriterPort` — JSONL format | Append-only, replayed on startup. Backup success never lost to infra failure |
| `notifyWarning(project, message)` | Generic warning method for timeouts, missing assets, disk space |
| `RemoteStoragePort.sync(paths, options)` | Options object `{ tags, snapshotMode }` for tagging + mode |
| `ClockPort` | Deterministic testing, timestamps in `TIMEZONE` (default `Europe/Berlin`) |
| Compression always on | No toggle. Each dumper uses best method per DB type |
| Explicit TypeORM migrations | No `synchronize: true`. Safe for production |
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
npx typeorm migration:run -d src/infrastructure/persistence/audit/data-source.ts
```

## Testing

TDD approach — write tests first, then implementation.

### Test Structure

```
test/
├── unit/
│   ├── shared/                    # child-process util, format util
│   ├── domain/
│   │   ├── backup/models/         # Value object validation, accessors
│   │   ├── backup/policies/       # Retry policy pure function
│   │   └── config/models/         # ProjectConfig, RetentionPolicy
│   ├── application/
│   │   ├── backup/                # Orchestrator (flow, lock, dry-run, retry, fallback, timeout)
│   │   ├── audit/                 # Audit query, startup recovery
│   │   └── ...services
│   └── infrastructure/
│       ├── adapters/              # dumpers, storage, notifiers, encryptors, config...
│       ├── persistence/           # TypeORM audit, JSONL fallback, file lock
│       ├── cli/                   # Command parsing, exit codes, flags
│       ├── http/                  # Controller responses
│       └── scheduler/             # Cron registration with lock
└── integration/
    ├── config/                    # Full YAML + .env end-to-end
    ├── audit/                     # TypeORM CRUD + migrations
    ├── flow/                      # Full backup flow
    └── cli/                       # End-to-end CLI via CommandTestFactory
```

### What to Test

- **Domain models:** Validation, accessors (`hasEncryption()`, `hasTimeout()`)
- **Domain policies:** Retry — retryable/non-retryable stages, exponential backoff
- **Orchestrator:** 11-step flow, lock acquire/release, dry run, retry, fallback, timeout warning, missing assets
- **Startup recovery:** Orphan marking, fallback replay, restic unlock, GPG import
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
- Mock TypeORM repository for audit adapter
- All outbound ports mocked in orchestrator tests via DI tokens
- `ClockPort` mock for deterministic timestamps

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

`StartupRecoveryService` on `onModuleInit`:
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

Host scripts: `scripts/deploy.sh`, `scripts/backupctl-manage.sh`

## Files to Never Commit

- `.env` (secrets)
- `ssh-keys/` (SSH private keys)
- `gpg-keys/`
- `node_modules/`, `dist/`
- `*.sql.gz`, `*.gpg` (backup artifacts)
- `*.lock` (backup lock files)
