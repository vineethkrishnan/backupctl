# Development Guide

This guide covers setting up a local development environment, running the app with hot reload inside Docker, running tests, and working with TypeORM migrations.

---

## Dev Script (`scripts/dev.sh`)

The `scripts/dev.sh` script is the single entry point for managing the dev environment, running tests, executing CLI commands, and working with TypeORM migrations.

```bash
scripts/dev.sh help    # Show all available commands
```

### Quick Reference

| Command | Description |
|---------|-------------|
| `scripts/dev.sh up` | Start dev environment (build + hot reload) |
| `scripts/dev.sh down` | Stop dev environment |
| `scripts/dev.sh restart` | Rebuild and restart |
| `scripts/dev.sh status` | Show container status and health |
| `scripts/dev.sh logs [db]` | Tail logs (all services, or just DB) |
| `scripts/dev.sh shell` | Open shell in dev container |
| `scripts/dev.sh reset` | Destroy volumes and recreate (fresh DB) |
| `scripts/dev.sh cli <cmd>` | Run backupctl CLI command |
| `scripts/dev.sh test [watch\|cov\|e2e]` | Run tests |
| `scripts/dev.sh lint [fix]` | Run linter |
| `scripts/dev.sh db:shell` | Open psql shell to audit database |
| `scripts/dev.sh migrate:run` | Run pending migrations |
| `scripts/dev.sh migrate:revert` | Revert the last migration |
| `scripts/dev.sh migrate:show` | Show migration status |
| `scripts/dev.sh migrate:generate <Name>` | Generate migration from entity diff |
| `scripts/dev.sh migrate:create <Name>` | Create an empty migration file |

---

## Docker Dev Environment

The dev environment uses `docker-compose.dev.yml` with a separate `Dockerfile.dev` that:

- Installs **all** dependencies (including devDependencies)
- Mounts `src/` and `test/` as volumes so changes are reflected instantly
- Runs `npm run start:dev` (NestJS watch mode) for hot reload
- Waits for the audit database to be healthy before starting
- Exposes the audit DB port for local tooling (pgAdmin, DBeaver, psql)

### Start Dev Environment

```bash
scripts/dev.sh up
```

The first build installs all dependencies inside the container. Subsequent starts reuse the cached image unless `package.json` changes.

### View Logs

```bash
scripts/dev.sh logs          # All services
scripts/dev.sh logs db       # Database only
```

### Stop Dev Environment

```bash
scripts/dev.sh down
```

### Reset Database (destroy volume)

```bash
scripts/dev.sh reset
```

### Run CLI Commands in Dev

```bash
scripts/dev.sh cli health
scripts/dev.sh cli config validate
scripts/dev.sh cli run <project> --dry-run
```

### Run Tests Inside Container

```bash
scripts/dev.sh test           # All tests
scripts/dev.sh test watch     # Watch mode
scripts/dev.sh test cov       # Coverage report
scripts/dev.sh test e2e       # Integration tests
```

### Shell into Container

```bash
scripts/dev.sh shell
```

---

## Local Development (Without Docker)

If you prefer running NestJS directly on your machine:

### Prerequisites

- Node.js 20 LTS
- PostgreSQL 16 (for the audit database)
- restic, gpg, openssh-client (for adapter integration tests)

### Setup

```bash
# Install dependencies
npm ci

# Copy environment template
cp .env.example .env

# Edit .env — set AUDIT_DB_HOST=localhost and your DB credentials
```

### Run

```bash
npm run start:dev       # HTTP server with watch mode
npx ts-node src/cli.ts  # CLI commands
```

### Test

```bash
npm test                # All tests
npm test -- --watch     # Watch mode
npm run test:cov        # Coverage report
npm run test:e2e        # Integration tests
```

### Lint & Format

```bash
npm run lint            # Lint + autofix
npm run lint:check      # Lint without fixing (CI mode)
npm run format          # Prettier format
```

---

## Project Structure Overview

```
src/
├── app/                    # AppModule — root wiring
├── domain/                 # Business logic organized by subdomain
│   ├── audit/              # Audit logging, fallback, recovery
│   ├── backup/             # Core backup orchestration
│   ├── config/             # YAML config loading
│   ├── health/             # Health checks
│   └── notification/       # Slack, email, webhook notifiers
├── common/                 # Shared utilities, DI tokens, clock
├── main.ts                 # HTTP entry point
└── cli.ts                  # CLI entry point

test/
├── unit/                   # Unit tests (mocked dependencies)
└── integration/            # Integration tests (real DB, full flows)
```

See [Architecture](02-architecture.md) for full details on the hexagonal design.

---

## Environment Variables for Development

Key variables in `.env` relevant for local dev:

| Variable | Dev Default | Description |
|----------|-------------|-------------|
| `AUDIT_DB_HOST` | `localhost` (local) / `backupctl-audit-db` (Docker) | Audit DB host |
| `AUDIT_DB_PORT` | `5432` | Audit DB port |
| `AUDIT_DB_NAME` | `backup_audit` | Audit DB name |
| `AUDIT_DB_USER` | `audit_user` | Audit DB user |
| `AUDIT_DB_PASSWORD` | `audit_secret` | Audit DB password |
| `APP_PORT` | `3100` | HTTP server port |
| `LOG_LEVEL` | `debug` | Set to `debug` for verbose dev output |
| `BACKUP_BASE_DIR` | `/data/backups` | Base directory for dump files |

---

## Switching Between Dev and Production

```bash
# Development (hot reload, source-mounted)
docker compose -f docker-compose.dev.yml up --build

# Production (optimized build, dist only)
docker compose up -d --build
```

The production `docker-compose.yml` uses the multi-stage `Dockerfile` which produces a lean image with only production dependencies. The dev compose uses `Dockerfile.dev` which includes the full toolchain.
