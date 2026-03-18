# Bash Scripts

backupctl ships with three host-side scripts for installation, deployment, and ongoing management. These scripts run on the Docker host machine — not inside the container. They wrap Docker and Docker Compose commands with validation, health checks, and interactive prompts.

## Overview

| Script | Purpose | When to use |
|--------|---------|-------------|
| `scripts/install.sh` | Interactive first-time setup wizard | Initial deployment on a fresh server |
| `scripts/deploy.sh` | Build and deploy containers | CI/CD pipelines, automated deployments |
| `scripts/backupctl-manage.sh` | Day-to-day management | Operations, debugging, updates |

All scripts are designed to be run from the project root directory.

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
  SSH key path [./ssh-keys/id_rsa]:
  Generate new SSH key pair? [Y/n]: Y
  ✅ SSH key pair generated at ./ssh-keys/id_rsa

── Encryption ───────────────────────────────

  Enable GPG encryption by default? [y/N]: y
  GPG recipient email: backup@company.com

── Notification ─────────────────────────────

  Default notification type (slack/email/webhook) [slack]: slack
  Slack webhook URL: https://hooks.slack.com/services/T.../B.../xxx

── Projects ─────────────────────────────────

  Add a project? [Y/n]: Y

  Project name: locaboo
  Database type (postgres/mysql/mongo): postgres
  Database host: postgres-locaboo
  Database port [5432]: 5432
  Database name: locaboo_db
  Database user: backup_user
  Database password: ********
  Cron schedule [0 0 * * *]: 0 0 * * *
  Restic repository path [/backups/locaboo]: /backups/locaboo

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
| `ssh-keys/id_rsa` | SSH key pair (if generated) |

---

## scripts/deploy.sh

Minimal build-and-deploy script suitable for CI/CD pipelines. Validates configuration, builds the Docker image, starts containers, and runs a health check.

### What It Does

1. **Validate config** — if the container is already running, executes `backupctl config validate` before building. Aborts on validation errors.
2. **Build Docker image** — runs `docker compose build` to build the backupctl image
3. **Start containers** — runs `docker compose up -d` to start (or restart) containers in detached mode
4. **Run health check** — waits for the container to be ready, then executes `backupctl health` to verify all dependencies are reachable

### Usage

```bash
./scripts/deploy.sh
```

### Example Output

```
$ ./scripts/deploy.sh

=== backupctl deploy ===

[1/4] Validating configuration...
  ✅ 3 project(s) valid

[2/4] Building Docker image...
  Building backupctl ... done
  Building backupctl-audit-db ... done

[3/4] Starting containers...
  Container backupctl-audit-db started
  Container backupctl started

[4/4] Running health check...
  Waiting for container to be ready...
  ✅ Audit DB — Connected
  ✅ Disk space — 42.0 GB free
  ✅ SSH — Connected
  ✅ Restic repos — All 3 accessible

Deploy complete.
```

### CI/CD Integration

The script exits with code `0` on success and `1` on any failure, making it suitable for CI/CD pipelines:

```bash
ssh deploy@server 'cd /opt/backupctl && ./scripts/deploy.sh'
```

---

## scripts/backupctl-manage.sh

Comprehensive management script for day-to-day operations. Wraps common Docker, container, and backupctl commands into a single interface.

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
  ✅ ssh-keys/id_rsa exists (permissions: 600)
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

#### update

Pull the latest code, rebuild the image, and restart. Useful for applying updates from the repository.

```
$ ./scripts/backupctl-manage.sh update

=== backupctl update ===

  Pulling latest changes... done (3 files changed)
  Rebuilding image... done
  Restarting containers... done
  Running health check... ✅ passed

Update complete.
```

#### logs

Tail the Docker container logs. Follows output in real-time until interrupted with Ctrl-C.

```
$ ./scripts/backupctl-manage.sh logs

Tailing backupctl logs (Ctrl-C to stop)...

backupctl  | [2026-03-18 00:00:00] [info] Application started on port 3100
backupctl  | [2026-03-18 00:00:01] [info] Startup recovery completed
backupctl  | [2026-03-18 00:00:01] [info] Registered cron: locaboo (0 0 * * *)
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

/app # ls /data/backups/locaboo/
locaboo_db_20260318_000032.sql.gz.gpg
uploads/
assets/

/app # exit
```

#### backup-dir

Display backup directory sizes for all projects. Useful for monitoring disk usage.

```
$ ./scripts/backupctl-manage.sh backup-dir

=== Backup Directory Sizes ===

/data/backups/locaboo        1.2 GB
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
  locaboo     ✅ 2026-03-18 00:01:24 (1m 19s)
  project-x   ✅ 2026-03-18 01:32:25 (1m 25s)
  project-y   ❌ 2026-03-18 02:00:12 (failed: Dump)

Next scheduled:
  locaboo     2026-03-19 00:00:00 (in 23h 58m)
  project-x   2026-03-19 01:30:00 (in 25h 28m)
  project-y   2026-03-19 02:00:00 (in 25h 58m)
```

---

## When to Use Which

| Scenario | Script |
|----------|--------|
| First-time installation on a new server | `scripts/install.sh` |
| CI/CD automated deployment | `scripts/deploy.sh` |
| Manual deploy after config change | `backupctl-manage.sh deploy` |
| Force rebuild after Dockerfile change | `backupctl-manage.sh deploy --rebuild` |
| Apply code updates from git | `backupctl-manage.sh update` |
| Check if environment is ready | `backupctl-manage.sh check` |
| Debug a container issue | `backupctl-manage.sh shell` |
| Monitor disk usage | `backupctl-manage.sh backup-dir` |
| Quick operational overview | `backupctl-manage.sh status` |
| Watch live logs | `backupctl-manage.sh logs` |

### Typical Workflow

**First-time setup:**

```bash
git clone <repo> /opt/backupctl
cd /opt/backupctl
./scripts/install.sh
```

**Day-to-day operations:**

```bash
./scripts/backupctl-manage.sh status     # check health
./scripts/backupctl-manage.sh logs       # investigate issues
./scripts/backupctl-manage.sh shell      # run CLI commands
./scripts/backupctl-manage.sh backup-dir # monitor disk
```

**Deploying updates:**

```bash
cd /opt/backupctl
git pull
./scripts/backupctl-manage.sh update
```

---

## What's Next

- **CLI commands inside the container** — [CLI Reference](06-cli-reference.md) documents all 14 commands.
- **Understand the backup pipeline** — [Backup Flow](08-backup-flow.md) explains the 11-step orchestration.
- **Configure projects** — [Configuration](05-configuration.md) covers the YAML format and `.env` variables.
