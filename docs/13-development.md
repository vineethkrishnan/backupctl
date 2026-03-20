# Development Guide

This guide covers setting up a local development environment for backupctl, including Docker networking for cross-container database access, the socat relay for Hetzner Storage Box connectivity, running tests, static analysis, and working with TypeORM migrations.

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| Docker + Docker Compose v2 | Via Colima (macOS) or Docker Engine (Linux) |
| Node.js 20 LTS | For running tests and linting on the host (optional) |
| socat | macOS only — for Hetzner SSH relay (see [Hetzner Relay](#hetzner-storage-box-relay-macos)) |
| Git | For version control |

---

## Quick Start

```bash
# 1. Clone and enter the project
git clone <repo-url> backupctl && cd backupctl

# 2. Copy environment template and configure
cp .env.example .env
# Edit .env with your credentials

# 3. Start the dev environment
scripts/dev.sh up

# 4. Run health check
scripts/dev.sh cli health

# 5. Validate config
scripts/dev.sh cli config validate
```

---

## Dev Script (`scripts/dev.sh`)

The `scripts/dev.sh` script is the single entry point for managing the dev environment.

```bash
scripts/dev.sh help    # Show all available commands
```

### Command Reference

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
| `scripts/dev.sh analyze [target]` | Static analysis (dead-code, duplicates, strict, all) |
| `scripts/dev.sh db:shell` | Open psql shell to audit database |
| `scripts/dev.sh migrate:run` | Run pending migrations |
| `scripts/dev.sh migrate:revert` | Revert the last migration |
| `scripts/dev.sh migrate:show` | Show migration status |
| `scripts/dev.sh migrate:generate <Name>` | Generate migration from entity diff |
| `scripts/dev.sh migrate:create <Name>` | Create an empty migration file |

---

## Docker Dev Environment

### Architecture

The dev environment uses `docker-compose.dev.yml` with three containers:

| Container | Image | Purpose | Port |
|-----------|-------|---------|------|
| `backupctl-dev` | `Dockerfile.dev` | App with hot reload | `3100` |
| `backupctl-audit-db` | `postgres:16-alpine` | Audit database | `5432` |
| `backupctl-pgadmin` | `dpage/pgadmin4` | Database browser | `5050` |

The dev Dockerfile:
- Installs **all** dependencies (including devDependencies)
- Mounts `src/` and `test/` as volumes for instant code changes
- Runs `npm run start:dev` (NestJS watch mode) for hot reload
- Waits for the audit database to be healthy before starting

### Starting the Environment

```bash
scripts/dev.sh up
```

On startup, the script:
1. Builds and starts all three containers
2. **Auto-connects project Docker networks** (reads `docker_network` from `config/projects.yml`)
3. Prints service URLs

```
  Services
  → App:      http://localhost:3100
  → pgAdmin:  http://localhost:5050
  → Audit DB: localhost:5432
```

### pgAdmin

Access pgAdmin at **http://localhost:5050** — no login required (server mode disabled). The audit database is pre-configured as a server connection.

### Docker Network Auto-Connect

If a project's database runs in a separate Docker Compose stack (e.g., your application's own `docker-compose.yml`), backupctl needs to join that network to reach the database.

Add the `docker_network` field to your project in `config/projects.yml`:

```yaml
projects:
  - name: my-project
    docker_network: myapp_default    # Docker network where the DB lives
    database:
      host: postgres                 # hostname on that network
      # ...
```

On `scripts/dev.sh up` or `restart`, the script automatically runs `docker network connect` for each project's network. If no `docker_network` is specified, the database is assumed reachable directly (host machine or already-connected network).

To see available Docker networks:

```bash
docker network ls
```

### Volume Mounts

| Host Path | Container Path | Mode |
|-----------|---------------|------|
| `./src` | `/app/src` | read-write (hot reload) |
| `./test` | `/app/test` | read-write |
| `./config` | `/app/config` | read-only |
| `./ssh-keys` | `/home/node/.ssh` | read-only |
| `./gpg-keys` | `/app/gpg-keys` | read-only |
| `./tmp` | `/data/backups` | read-write (backup data) |

### Environment Overrides

`docker-compose.dev.yml` overrides certain `.env` values for the dev environment:

```yaml
environment:
  AUDIT_DB_HOST: backupctl-audit-db
  NODE_ENV: development
  # Hetzner relay (macOS only — see section below)
  HETZNER_SSH_HOST: host.docker.internal
  HETZNER_SSH_PORT: "2323"
```

These overrides only apply to the dev container. Production uses the values from `.env` directly.

---

## Hetzner Storage Box Relay (macOS)

### The Problem

On macOS, Docker runs inside a lightweight VM (Colima or Docker Desktop). The VM only has IPv4 outbound connectivity. Many ISPs block outbound TCP port 23 on IPv4 — and Hetzner Storage Boxes use port 23 for SSH/SFTP.

Your Mac connects to Hetzner over **IPv6** (which bypasses the ISP block), but the Docker VM has no IPv6.

**Symptoms:**
- `scripts/dev.sh cli health` shows SSH as failed
- `nc -z u547206.your-storagebox.de 23` works from the Mac terminal but fails from inside Docker
- Restic commands hang or fail with "Connection refused"

### The Solution: socat Relay

Run a `socat` process on the Mac host that bridges IPv4 traffic from Docker to Hetzner over IPv6:

```
Docker (IPv4) → host.docker.internal:2323 → socat (Mac) → IPv6 → Hetzner:23
```

### Setup

**1. Install socat (one-time):**

```bash
brew install socat
```

**2. Start the relay:**

```bash
socat "TCP4-LISTEN:2323,fork,reuseaddr" "TCP6:[2a01:4f8:2b01:ac::2]:23" &
```

Replace `2a01:4f8:2b01:ac::2` with your storage box's IPv6 address. Find it with:

```bash
dig AAAA u547206.your-storagebox.de +short
```

**3. Verify:**

```bash
# From Docker — should succeed
docker exec backupctl-dev nc -z -w 3 host.docker.internal 2323

# Test SSH
docker exec backupctl-dev ssh -i /home/node/.ssh/id_ed25519 -p 2323 \
  -o StrictHostKeyChecking=no u547206@host.docker.internal ls
```

### How It Works with docker-compose.dev.yml

The dev compose file already overrides the SSH host and port:

```yaml
environment:
  HETZNER_SSH_HOST: host.docker.internal
  HETZNER_SSH_PORT: "2323"
```

And `ssh-keys/config` has an entry for the relay host:

```
Host host.docker.internal
    User u547206
    Port 2323
    IdentityFile /home/node/.ssh/id_ed25519
    StrictHostKeyChecking no
```

So once the socat relay is running, all backupctl commands (health, restic, run) work transparently.

### Stopping the Relay

```bash
pkill -f "socat.*2323"
```

### Why This Isn't Needed on Linux

On Linux production servers, Docker shares the host's network stack. If the host has IPv6 or port 23 is not blocked, Docker containers can reach Hetzner directly. The socat relay is a **macOS development-only** workaround.

---

## Running Tests

### Inside Docker (Recommended)

```bash
scripts/dev.sh test           # All tests
scripts/dev.sh test watch     # Watch mode (interactive)
scripts/dev.sh test cov       # Coverage report
scripts/dev.sh test e2e       # Integration tests
```

### On the Host

```bash
npm test                      # All tests
npm test -- --watch           # Watch mode
npm run test:cov              # Coverage report
npm run test:e2e              # Integration tests
```

### Test Structure

```
test/
├── unit/                     # Mocked dependencies
│   ├── domain/               # Domain models, policies
│   ├── application/          # Use cases, registries
│   ├── infrastructure/       # Adapters, CLI, scheduler
│   └── shared/               # Utilities
└── integration/              # Real DB, full flows
    ├── config/               # YAML + .env resolution
    ├── audit/                # TypeORM CRUD + migrations
    ├── flow/                 # Full backup pipeline
    └── cli/                  # End-to-end CLI
```

---

## Static Analysis

### All Checks at Once

```bash
scripts/dev.sh analyze
```

Runs ESLint, dead code detection (knip), and code duplication (jscpd).

### Individual Checks

```bash
scripts/dev.sh analyze dead-code    # Find unused exports/files (knip)
scripts/dev.sh analyze duplicates   # Detect copy-paste code (jscpd)
scripts/dev.sh analyze strict       # Strict type-safety (eslint)
scripts/dev.sh lint                 # Standard ESLint check
scripts/dev.sh lint fix             # ESLint with autofix
```

### CI Equivalents

These same checks run in GitHub Actions CI:

| Workflow | Script |
|----------|--------|
| `.github/workflows/quality-dead-code.yml` | `npm run lint:dead-code` (knip) |
| `.github/workflows/quality-dry.yml` | `npm run lint:duplicates` (jscpd) |
| `.github/workflows/quality-strict-ts.yml` | `npm run lint:strict` (eslint) |

---

## TypeORM Migrations

### Check Status

```bash
scripts/dev.sh migrate:show
```

### Run Pending Migrations

```bash
scripts/dev.sh migrate:run
```

### Generate from Entity Changes

After modifying a `*.record.ts` file (TypeORM entity):

```bash
scripts/dev.sh migrate:generate AddNewColumn
```

Review the generated file in `src/db/migrations/` before applying.

### Create Empty Migration

For manual schema changes:

```bash
scripts/dev.sh migrate:create SeedInitialData
```

### Revert Last Migration

```bash
scripts/dev.sh migrate:revert
```

See [Migrations](14-migrations.md) for detailed patterns and best practices.

---

## Local Development (Without Docker)

If you prefer running NestJS directly on your machine:

### Prerequisites

- Node.js 20 LTS
- PostgreSQL 16 (for the audit database)
- restic, gpg, openssh-client (for adapter tests)

### Setup

```bash
npm ci
cp .env.example .env
# Edit .env — set AUDIT_DB_HOST=localhost
```

### Run

```bash
npm run start:dev              # HTTP server with watch mode
npx ts-node src/cli.ts health  # CLI commands
```

### Lint & Format

```bash
npm run lint            # Lint + autofix
npm run lint:check      # Lint without fixing (CI mode)
npm run format          # Prettier format
```

---

## Switching Between Dev and Production

Dev and prod containers share port 3100, container names, and volumes. **Never run both simultaneously.**

```bash
# Switch from dev to prod
scripts/dev.sh down
docker compose up -d --build

# Switch from prod to dev
docker compose down
scripts/dev.sh up
```

Quick check — which is running?

```bash
docker ps --format '{{.Names}}' | grep backupctl
# backupctl-dev  → dev environment
# backupctl      → production
```

---

## Environment Variables for Development

Key variables in `.env` relevant for dev:

| Variable | Docker Dev | Local Dev | Description |
|----------|------------|-----------|-------------|
| `AUDIT_DB_HOST` | `backupctl-audit-db` (override) | `localhost` | Audit DB host |
| `AUDIT_DB_PORT` | `5432` | `5432` | Audit DB port |
| `APP_PORT` | `3100` | `3100` | HTTP server port |
| `LOG_LEVEL` | `info` | `debug` | Set to `debug` for verbose output |
| `BACKUP_BASE_DIR` | `/data/backups` (mapped to `./tmp`) | `/data/backups` | Backup data directory |

---

## CLI Shortcuts

Install `backupctl-dev` so you can run dev CLI commands from any directory:

```bash
./scripts/install-cli.sh
```

Then use:

```bash
backupctl-dev health                   # instead of: scripts/dev.sh cli health
backupctl-dev run myproject --dry-run  # instead of: scripts/dev.sh cli run myproject --dry-run
backupctl-dev config show myproject    # instead of: scripts/dev.sh cli config show myproject
```

See [Installation → CLI Shortcuts](04-installation.md#11-cli-shortcuts) for details.

---

## Useful Dev Commands

```bash
# Health check
scripts/dev.sh cli health         # or: backupctl-dev health

# Validate config
scripts/dev.sh cli config validate

# Show project config (secrets masked)
scripts/dev.sh cli config show myproject

# Dry-run a backup
scripts/dev.sh cli run myproject --dry-run

# Open psql to audit DB
scripts/dev.sh db:shell

# Shell into container
scripts/dev.sh shell

# Full static analysis
scripts/dev.sh analyze
```

---

## What's Next

- **Configure projects** — [Configuration](05-configuration.md) covers YAML format and all fields
- **Run backups** — [CLI Reference](06-cli-reference.md) for all 14 commands
- **Understand the flow** — [Backup Flow](08-backup-flow.md) for the 11-step pipeline
- **Database migrations** — [Migrations](14-migrations.md) for TypeORM patterns
