# Bash Scripts

backupctl ships with host-side scripts for installation, development, deployment, and ongoing management. These scripts run on the Docker host machine — not inside the container. They wrap Docker and Docker Compose commands with validation, health checks, and interactive prompts.

## Overview

| Script | Purpose | When to use |
|--------|---------|-------------|
| `scripts/install.sh` | Interactive first-time setup wizard | Initial deployment on a fresh server |
| `scripts/dev.sh` | Development environment manager | Local development, testing, migrations |
| `scripts/backupctl-manage.sh` | Production management | Operations, deployment, debugging, updates |

All scripts are designed to be run from the project root directory.

### Docker Network Auto-Connect

Both `dev.sh` and `backupctl-manage.sh` automatically connect the backupctl container to Docker networks declared in `config/projects.yml` via the `docker_network` field. This happens on `up`, `restart`, `deploy`, and `upgrade` commands. See [Configuration](05-configuration.md) for details on the `docker_network` field.

---

## scripts/install.sh

Interactive installation wizard that configures backupctl from scratch with zero manual file editing. Walks through every configuration option with sensible defaults and generates all required files.

### What It Does

1. **Check prerequisites** — verifies Docker, Docker Compose, and required system tools are installed
2. **Collect global settings** — timezone, backup base directory, log level, app port
3. **Configure audit database** — PostgreSQL host, port, credentials (generates secure defaults)
4. **Configure Hetzner Storage Box** — SSH host, user, key path; optionally generates an SSH key pair
5. **Set encryption defaults** — global GPG toggle, recipient email
6. **Set notification defaults** — global notification type and channel config (Slack webhook URL, SMTP settings, or webhook endpoint)
7. **Configure retry policy** — retry count and delay
8. **Add projects** — interactive loop to add one or more projects with database, schedule, retention, and notification settings
9. **Generate files** — writes `.env`, `config/projects.yml`, and creates required directories
10. **Initialize restic repos** — optionally initializes restic repositories for each project
11. **Run first health check** — starts containers and verifies everything works

### Prerequisites

The script checks for these before proceeding:

- Docker Engine 20.10+
- Docker Compose v2+
- `ssh-keygen` (for SSH key generation)
- Network access to the Hetzner Storage Box (if configuring remote storage)

### Usage

```bash
./scripts/install.sh
```

### Example Session

```
$ ./scripts/install.sh

╔══════════════════════════════════════════╗
║        backupctl Setup Wizard           ║
╚══════════════════════════════════════════╝

Checking prerequisites...
  ✅ Docker 24.0.7
  ✅ Docker Compose v2.23.0
  ✅ ssh-keygen available

── Global Settings ──────────────────────────

  Timezone [Europe/Berlin]: Europe/Berlin
  Backup base directory [/data/backups]: /data/backups
  App port [3100]: 3100
  Log level (debug/info/warn/error) [info]: info

── Audit Database ───────────────────────────

  Database name [backup_audit]: backup_audit
  Database user [audit_user]: audit_user
  Database password [auto-generated]: ********

── Hetzner Storage Box ──────────────────────

  SSH host: u123456.your-storagebox.de
  SSH user: u123456
  SSH key path [./ssh-keys/id_ed25519]:
  Generate new SSH key pair? [Y/n]: Y
  ✅ SSH key pair generated at ./ssh-keys/id_ed25519

── Encryption ───────────────────────────────

  Enable GPG encryption by default? [y/N]: y
  GPG recipient email: backup@company.com

── Notification ─────────────────────────────

  Default notification type (slack/email/webhook) [slack]: slack
  Slack webhook URL: https://hooks.slack.com/services/T.../B.../xxx

── Projects ─────────────────────────────────

  Add a project? [Y/n]: Y

  Project name: vinsware
  Database type (postgres/mysql/mongo): postgres
  Database host: postgres-vinsware
  Database port [5432]: 5432
  Database name: vinsware_db
  Database user: backup_user
  Database password: ********
  Cron schedule [0 0 * * *]: 0 0 * * *
  Restic repository path [/backups/vinsware]: /backups/vinsware

  Add another project? [y/N]: N

── Generating Files ─────────────────────────

  ✅ .env written
  ✅ config/projects.yml written
  ✅ Directories created

── Deploy ───────────────────────────────────

  Building Docker image...
  Starting containers...
  Running health check...
  ✅ All systems operational

Setup complete! Run "backupctl health" to verify.
```

### Generated Files

| File | Contents |
|------|----------|
| `.env` | All secrets and global settings |
| `config/projects.yml` | Project definitions with `${}` variable references |
| `ssh-keys/id_ed25519` | SSH key pair (if generated) |

---

## scripts/install-cli.sh

Installs `backupctl` and `backupctl-dev` as wrapper scripts so you can run CLI commands from any directory without the `docker exec` prefix.

### Usage

```bash
./scripts/install-cli.sh              # interactive — choose user or system install
./scripts/install-cli.sh --user       # install to ~/.local/bin (no sudo)
./scripts/install-cli.sh --system     # install to /usr/local/bin (requires sudo)
./scripts/install-cli.sh --uninstall  # remove both commands
```

### What It Creates

| Command | Delegates to | Container |
|---------|-------------|-----------|
| `backupctl` | `docker exec backupctl node dist/cli.js` | Production |
| `backupctl-dev` | `docker exec backupctl-dev npx ts-node src/cli.ts` | Development |

After installation:

```bash
backupctl health                       # production
backupctl run vinsware --dry-run
backupctl-dev health                   # development
backupctl-dev config show vinsware
```

The wrapper scripts check if the target container is running and give a helpful error with start instructions if not.

---

## scripts/dev.sh

Development environment manager. Single entry point for starting/stopping the dev Docker environment, running CLI commands, tests, linting, static analysis, and TypeORM migrations.

See the full [Development Guide](13-development.md) for detailed usage.

### Quick Reference

| Command | Description |
|---------|-------------|
| `dev.sh up` | Start dev environment (build + hot reload) |
| `dev.sh down` | Stop dev environment |
| `dev.sh restart` | Rebuild and restart |
| `dev.sh status` | Container status + health check |
| `dev.sh logs [db]` | Tail logs |
| `dev.sh shell` | Shell into dev container |
| `dev.sh reset` | Destroy volumes and recreate (fresh DB) |
| `dev.sh cli <cmd>` | Run backupctl CLI command |
| `dev.sh test [watch\|cov\|e2e]` | Run tests |
| `dev.sh lint [fix]` | Run linter |
| `dev.sh analyze [target]` | Static analysis: `dead-code`, `duplicates`, `strict`, `all` |
| `dev.sh db:shell` | Open psql to audit DB |
| `dev.sh migrate:run` | Run pending migrations |
| `dev.sh migrate:revert` | Revert last migration |
| `dev.sh migrate:show` | Show migration status |
| `dev.sh migrate:generate <Name>` | Generate migration from entity diff |
| `dev.sh migrate:create <Name>` | Create empty migration |

### Network Auto-Connect

On `up` and `restart`, `dev.sh` reads `docker_network` from each project in `config/projects.yml` and runs `docker network connect` to ensure the dev container can reach each project's database.

### Static Analysis

```bash
scripts/dev.sh analyze                # All checks (ESLint + knip + jscpd)
scripts/dev.sh analyze dead-code      # Unused exports/files (knip)
scripts/dev.sh analyze duplicates     # Copy-paste detection (jscpd)
scripts/dev.sh analyze strict         # Strict type-safety (eslint)
```

---

## scripts/backupctl-manage.sh

Production management script for deployment and day-to-day operations. Handles setup, deploy, upgrade, and diagnostics.

### Usage

```bash
./scripts/backupctl-manage.sh <subcommand> [options]
```

### Subcommands

#### setup

Interactive first-time setup. Delegates to the installation wizard logic — checks prerequisites, collects configuration, generates files, builds, and deploys.

```
$ ./scripts/backupctl-manage.sh setup

Starting backupctl setup...
(same interactive flow as install.sh)
```

#### check

Validate that all prerequisites are met and the environment is correctly configured. Does not start or modify anything.

```
$ ./scripts/backupctl-manage.sh check

=== Prerequisite Check ===

  ✅ Docker 24.0.7
  ✅ Docker Compose v2.23.0
  ✅ .env file exists
  ✅ config/projects.yml exists
  ✅ ssh-keys/id_ed25519 exists (permissions: 600)
  ✅ Backup directory /data/backups exists
  ✅ Docker network reachable

All prerequisites met.
```

#### deploy

Build and start containers. Equivalent to running `scripts/deploy.sh`.

```
$ ./scripts/backupctl-manage.sh deploy

Building and starting backupctl...
  Building images... done
  Starting containers... done
  Health check... ✅ passed

Deploy complete.
```

With `--rebuild` to force a fresh image build (no cache):

```
$ ./scripts/backupctl-manage.sh deploy --rebuild

Rebuilding backupctl (no cache)...
  Building images (--no-cache)... done
  Restarting containers... done
  Health check... ✅ passed

Deploy complete (rebuilt).
```

#### upgrade

Pull the latest code, rebuild the image, restart, and clear the upgrade check cache. This is the recommended way to apply updates from the repository.

```
$ ./scripts/backupctl-manage.sh upgrade

=== backupctl upgrade ===

  Pulling latest changes... done (3 files changed)
  Rebuilding image... done
  Restarting containers... done
  Running health check... ✅ passed
  Clearing upgrade check cache... done

=== backupctl upgraded ===
```

`update` is accepted as an alias for `upgrade`.

#### logs

Tail the Docker container logs. Follows output in real-time until interrupted with Ctrl-C.

```
$ ./scripts/backupctl-manage.sh logs

Tailing backupctl logs (Ctrl-C to stop)...

backupctl  | [2026-03-18 00:00:00] [info] Application started on port 3100
backupctl  | [2026-03-18 00:00:01] [info] Startup recovery completed
backupctl  | [2026-03-18 00:00:01] [info] Registered cron: vinsware (0 0 * * *)
backupctl  | [2026-03-18 00:00:01] [info] Registered cron: project-x (30 1 * * *)
backupctl  | [2026-03-18 00:00:01] [info] Registered cron: project-y (0 2 * * *)
^C
```

#### shell

Open an interactive shell inside the running container. Useful for debugging, running CLI commands directly, or inspecting files.

```
$ ./scripts/backupctl-manage.sh shell

Opening shell in backupctl container...

/app # node dist/cli.js health
=== System Health Check ===
  ✅ Audit DB — Connected
  ✅ Disk space — 42.0 GB free
  ...

/app # ls /data/backups/vinsware/
vinsware_db_20260318_000032.sql.gz.gpg
uploads/
assets/

/app # exit
```

#### backup-dir

Display backup directory sizes for all projects. Useful for monitoring disk usage.

```
$ ./scripts/backupctl-manage.sh backup-dir

=== Backup Directory Sizes ===

/data/backups/vinsware        1.2 GB
/data/backups/project-x      845 MB
/data/backups/project-y      320 MB
/data/backups/.logs          12 MB
────────────────────────────────────
Total                        2.4 GB
Free disk space              42.0 GB
```

#### status

Quick status overview showing container state, last backup results, and next scheduled runs.

```
$ ./scripts/backupctl-manage.sh status

=== backupctl Status ===

Container: running (uptime: 3d 14h 22m)
Audit DB:  connected (142 records)
Projects:  3 configured, 3 enabled

Last backups:
  vinsware     ✅ 2026-03-18 00:01:24 (1m 19s)
  project-x   ✅ 2026-03-18 01:32:25 (1m 25s)
  project-y   ❌ 2026-03-18 02:00:12 (failed: Dump)

Next scheduled:
  vinsware     2026-03-19 00:00:00 (in 23h 58m)
  project-x   2026-03-19 01:30:00 (in 25h 28m)
  project-y   2026-03-19 02:00:00 (in 25h 58m)
```

---

## When to Use Which

| Scenario | Script |
|----------|--------|
| First-time installation on a new server | `scripts/install.sh` |
| Start dev environment (hot reload) | `scripts/dev.sh up` |
| Run tests, lint, static analysis | `scripts/dev.sh test` / `lint` / `analyze` |
| Run CLI commands in dev | `scripts/dev.sh cli <cmd>` |
| TypeORM migrations | `scripts/dev.sh migrate:run` |
| Production deploy after config change | `backupctl-manage.sh deploy` |
| Force production rebuild | `backupctl-manage.sh deploy --rebuild` |
| Apply code updates (prod) | `backupctl-manage.sh upgrade` |
| Check prod prerequisites | `backupctl-manage.sh check` |
| Debug production container | `backupctl-manage.sh shell` |
| Monitor disk usage (prod) | `backupctl-manage.sh backup-dir` |
| Quick operational overview (prod) | `backupctl-manage.sh status` |
| Watch production logs | `backupctl-manage.sh logs` |

### Typical Workflow

**First-time setup (production):**

```bash
git clone <repo> /opt/backupctl
cd /opt/backupctl
./scripts/install.sh
```

**Development:**

```bash
scripts/dev.sh up                        # start dev environment
scripts/dev.sh cli health                # health check
scripts/dev.sh cli run myproject --dry-run
scripts/dev.sh test                      # run tests
scripts/dev.sh analyze                   # full static analysis
```

**Production operations:**

```bash
./scripts/backupctl-manage.sh status     # check health
./scripts/backupctl-manage.sh logs       # investigate issues
./scripts/backupctl-manage.sh shell      # run CLI commands
./scripts/backupctl-manage.sh backup-dir # monitor disk
```

**Deploying production updates:**

```bash
cd /opt/backupctl
./scripts/backupctl-manage.sh upgrade
```

---

## What's Next

- **CLI commands inside the container** — [CLI Reference](06-cli-reference.md) documents all 14 commands.
- **Understand the backup pipeline** — [Backup Flow](08-backup-flow.md) explains the 11-step orchestration.
- **Configure projects** — [Configuration](05-configuration.md) covers the YAML format and `.env` variables.
