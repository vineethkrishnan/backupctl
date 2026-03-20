# Installation

This guide covers deploying backupctl on a fresh server. There are three paths:

1. **Quick install** — one command, pulls a pre-built Docker image (fastest)
2. **Installation wizard** — interactive setup that generates all config files
3. **Manual setup** — step-by-step for full control

## Prerequisites

| Requirement | Minimum version | Notes |
|-------------|----------------|-------|
| Docker | 24+ | Docker Engine with BuildKit |
| Docker Compose | v2 (`docker compose`) | Plugin or standalone |
| SSH access | — | Hetzner Storage Box with SSH/SFTP enabled |
| GPG | 2.x | Optional — only if using dump encryption |
| Disk space | 5+ GB free | Configurable via `HEALTH_DISK_MIN_FREE_GB` |
| curl | — | For the quick installer |

The host OS should be Linux (Ubuntu 24.04 recommended). macOS works for local development but production deployments target Linux.

## Docker Images

backupctl is published as a Docker image on every release:

```bash
# Docker Hub
docker pull vineethnkrishnan/backupctl:latest

# GitHub Container Registry
docker pull ghcr.io/vineethkrishnan/backupctl:latest
```

Tags follow semver: `latest`, `1`, `1.0`, `1.0.0`.

---

## Option A: Quick Install (Recommended)

A single command that pulls the pre-built image, generates `docker-compose.yml`, downloads management scripts, and sets up the directory structure.

```bash
curl -fsSL https://raw.githubusercontent.com/vineethkrishnan/backupctl/main/scripts/get-backupctl.sh | bash
```

Custom install directory:

```bash
curl -fsSL https://raw.githubusercontent.com/vineethkrishnan/backupctl/main/scripts/get-backupctl.sh | bash -s -- --dir /opt/backupctl
```

Pin to a specific version:

```bash
curl -fsSL https://raw.githubusercontent.com/vineethkrishnan/backupctl/main/scripts/get-backupctl.sh | bash -s -- --version 1.0.0
```

After the installer finishes, run the interactive setup wizard:

```bash
cd ~/backupctl
bash scripts/install.sh
```

This generates `.env` and `config/projects.yml` from your answers, sets up SSH keys, initializes restic repos, and optionally starts the service.

---

## Option B: Installation Wizard (From Source)

Clone the repository and run the interactive setup. This builds the Docker image locally instead of pulling a pre-built one.

```bash
git clone https://github.com/vineethkrishnan/backupctl.git && cd backupctl
./scripts/install.sh
```

The wizard walks through the following sections:

### 1. Prerequisites Check

Verifies that Docker, Docker Compose, git, openssl, and ssh-keygen are installed and accessible.

```
=== backupctl Installation Wizard ===

[1/10] Checking prerequisites...
  ✓ Docker 27.3.1
  ✓ Docker Compose v2.30.3
  ✓ git 2.43.0
  ✓ openssl 3.0.13
  ✓ ssh-keygen (OpenSSH_9.6p1)
All prerequisites met.
```

### 2. Application Settings

Prompts for core service configuration with sensible defaults.

```
[2/10] Application settings
  APP_PORT [3100]:
  TIMEZONE [Europe/Berlin]:
  BACKUP_BASE_DIR [/data/backups]:
  LOG_LEVEL (debug|info|warn|error) [info]:
  HEALTH_DISK_MIN_FREE_GB [5]:
```

### 3. Audit Database

Configures the PostgreSQL audit database. The password is auto-generated if left blank.

```
[3/10] Audit database
  AUDIT_DB_HOST [backupctl-audit-db]:
  AUDIT_DB_PORT [5432]:
  AUDIT_DB_NAME [backup_audit]:
  AUDIT_DB_USER [audit_user]:
  AUDIT_DB_PASSWORD [auto-generated]: ********
  Generated password: k8f2...a9d1 (saved to .env)
```

### 4. Hetzner Storage Box

Configures SSH access, generates a key pair if needed, copies the public key, scans `known_hosts`, and verifies the connection.

```
[4/10] Hetzner Storage Box
  HETZNER_SSH_HOST: u123456.your-storagebox.de
  HETZNER_SSH_USER: u123456

  SSH key not found at ./ssh-keys/id_ed25519
  Generating Ed25519 key pair... done.

  Copy public key to storage box? [Y/n]: Y
  Copying... done.

  Scanning known_hosts... done.
  Testing SSH connection... ✓ Connected.
```

### 5. Restic

Sets a global restic repository password and retry configuration.

```
[5/10] Restic configuration
  RESTIC_PASSWORD: ********
  BACKUP_RETRY_COUNT [3]:
  BACKUP_RETRY_DELAY_MS [5000]:
```

### 6. Notifications

Choose a global notification channel and enter channel-specific settings.

```
[6/10] Notification defaults
  NOTIFICATION_TYPE (slack|email|webhook|none) [slack]: slack
  SLACK_WEBHOOK_URL: https://hooks.slack.com/services/T.../B.../xxx
  DAILY_SUMMARY_CRON [0 8 * * *]:
```

For email, the wizard prompts for `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_TO`, `SMTP_FROM`, and `SMTP_PASSWORD`. For webhook, it prompts for `WEBHOOK_URL`.

### 7. Encryption

Optionally enables GPG encryption globally and imports key files.

```
[7/10] Encryption
  Enable GPG encryption? [y/N]: y
  GPG_RECIPIENT: backup@company.com
  Import GPG key file? [y/N]: y
  Key file path: /path/to/backup-key.pub.gpg
  Copied to ./gpg-keys/backup-key.pub.gpg
```

### 8. Project Configuration

An interactive loop that builds `config/projects.yml` one project at a time.

```
[8/10] Project configuration
  Add a project? [Y/n]: Y

  Project name: locaboo
  Docker network (empty = host/default): locaboo_locaboo-network
  Database type (postgres|mysql|mongodb): postgres
  Database host: postgres-locaboo
  Database port [5432]:
  Database name: locaboo_db
  Database user: backup_user
  Database password: ********
  Cron schedule [0 2 * * *]: 0 0 * * *
  Timeout minutes (blank for none): 30
  Restic repo path [/backups/locaboo]:
  Restic password (blank for global):
  Snapshot mode (combined|separate) [combined]:
  Asset paths (comma-separated, blank for none): /data/locaboo/uploads, /data/locaboo/assets
  Enable verification? [Y/n]:
  Pre-backup hook (blank for none): curl -s http://locaboo-app:3000/maintenance/on
  Post-backup hook (blank for none): curl -s http://locaboo-app:3000/maintenance/off
  Notification override? [y/N]:

  ✓ locaboo added.

  Add another project? [Y/n]: N
```

### 9. File Generation

Generates `.env` and `config/projects.yml` from all collected values.

```
[9/10] Generating configuration files
  ✓ .env created
  ✓ config/projects.yml created
  ✓ Directories created: config/, ssh-keys/, gpg-keys/
```

### 10. Build and Deploy

Optionally builds the Docker image, starts containers, runs migrations, initializes restic repos, and runs a health check.

```
[11/13] Docker Setup
  Build and start containers now? [Y/n]: Y

  Building Docker image... done.
  Starting containers... done.
  Waiting for audit DB... ready.
  Running migrations... done.
  Initializing restic repo for locaboo... done.
  Running health check...
    ✓ Audit DB: connected
    ✓ Restic (locaboo): accessible
    ✓ Disk: 42 GB free (threshold: 5 GB)
    ✓ SSH: connected
```

### 11. CLI Shortcuts

Installs `backupctl` and `backupctl-dev` wrapper commands so you can run CLI commands from any directory without the `docker exec` prefix.

```
[12/13] CLI Shortcuts
  Install CLI shortcuts? [Y/n]: Y

  Install location:
    1) ~/.local/bin  (user only, no sudo)
    2) /usr/local/bin  (system-wide, requires sudo)

  Choose [1]: 1

  ✔ Installed backupctl → ~/.local/bin/backupctl
  ✔ Installed backupctl-dev → ~/.local/bin/backupctl-dev
```

After installation:

```bash
backupctl health                       # instead of: docker exec backupctl node dist/cli.js health
backupctl run locaboo --dry-run        # instead of: docker exec backupctl node dist/cli.js run locaboo --dry-run
backupctl-dev health                   # instead of: scripts/dev.sh cli health
```

You can also install shortcuts separately at any time:

```bash
./scripts/install-cli.sh               # interactive
./scripts/install-cli.sh --user        # install to ~/.local/bin
./scripts/install-cli.sh --system      # install to /usr/local/bin (sudo)
./scripts/install-cli.sh --uninstall   # remove both commands
```

## Option C: Manual Setup

### 1. Set Up the Project

**Using the pre-built image (recommended):**

```bash
mkdir backupctl && cd backupctl
mkdir -p config ssh-keys gpg-keys
```

**Or from source:**

```bash
git clone https://github.com/vineethkrishnan/backupctl.git && cd backupctl
npm ci
mkdir -p config ssh-keys gpg-keys
```

### 2. Create docker-compose.yml

If using the pre-built image, create a `docker-compose.yml`:

```yaml
services:
  backupctl:
    container_name: backupctl
    image: vineethnkrishnan/backupctl:latest
    env_file: .env
    environment:
      AUDIT_DB_HOST: backupctl-audit-db
    ports:
      - '${APP_PORT:-3100}:${APP_PORT:-3100}'
    volumes:
      - ${BACKUP_BASE_DIR:-/data/backups}:/data/backups
      - ./config:/app/config:ro
      - ./ssh-keys:/home/node/.ssh:ro
      - ./gpg-keys:/app/gpg-keys:ro
    networks:
      - backupctl-network
    depends_on:
      backupctl-audit-db:
        condition: service_healthy
    restart: unless-stopped
    stop_grace_period: 120s
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: '2'

  backupctl-audit-db:
    container_name: backupctl-audit-db
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ${AUDIT_DB_NAME:-backup_audit}
      POSTGRES_USER: ${AUDIT_DB_USER:-audit_user}
      POSTGRES_PASSWORD: ${AUDIT_DB_PASSWORD}
    volumes:
      - backupctl-audit-data:/var/lib/postgresql/data
    networks:
      - backupctl-network
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U ${AUDIT_DB_USER:-audit_user} -d ${AUDIT_DB_NAME:-backup_audit}']
      interval: 5s
      timeout: 3s
      retries: 5
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: '1'

volumes:
  backupctl-audit-data:

networks:
  backupctl-network:
    driver: bridge
```

If using from source, the repository already includes a `docker-compose.yml`.

### 3. Configure .env

Copy the example and fill in required values:

```bash
cp .env.example .env
```

Minimum required variables:

```env
# Audit DB
AUDIT_DB_PASSWORD=<generate-a-strong-password>

# Hetzner Storage Box
HETZNER_SSH_HOST=u123456.your-storagebox.de
HETZNER_SSH_USER=u123456

# Restic
RESTIC_PASSWORD=<generate-a-strong-password>

# At least one project DB password
LOCABOO_DB_PASSWORD=<db-password>
```

All other variables have sensible defaults. See [Configuration](05-configuration.md) for the full reference.

### 4. Configure projects.yml

Create `config/projects.yml` with at least one project:

```yaml
projects:
  - name: locaboo
    enabled: true
    cron: "0 2 * * *"
    docker_network: locaboo_locaboo-network  # optional — Docker network where DB lives

    database:
      type: postgres
      host: postgres-locaboo
      port: 5432
      name: locaboo_db
      user: backup_user
      password: ${LOCABOO_DB_PASSWORD}

    restic:
      repository_path: /backups/locaboo
      snapshot_mode: combined

    retention:
      local_days: 7
      keep_daily: 7
      keep_weekly: 4
      keep_monthly: 0
```

### 5. SSH Key Setup

Generate an SSH key pair, copy the public key to the Hetzner Storage Box, and scan the host key:

```bash
# Generate key (skip if you already have one)
ssh-keygen -t ed25519 -f ./ssh-keys/id_ed25519 -N ""

# Copy public key to storage box
cat ./ssh-keys/id_ed25519.pub | ssh u123456@u123456.your-storagebox.de install-ssh-key

# Scan host key for non-interactive use
ssh-keyscan u123456.your-storagebox.de > ./ssh-keys/known_hosts

# Verify connection
ssh -i ./ssh-keys/id_ed25519 u123456@u123456.your-storagebox.de ls
```

The `known_hosts` file is critical. Without it, SSH connections during cron-triggered backups will fail — there is no interactive host key confirmation in non-interactive mode.

### 6. GPG Keys (Optional)

If you want GPG encryption, place public key files in `gpg-keys/`:

```bash
# Export an existing key
gpg --export --armor backup@company.com > ./gpg-keys/backup.pub.gpg

# Or generate a new key and export it
gpg --full-generate-key
gpg --export --armor backup@company.com > ./gpg-keys/backup.pub.gpg
```

Enable encryption in `.env` or per-project in `projects.yml`:

```env
ENCRYPTION_ENABLED=true
GPG_RECIPIENT=backup@company.com
```

Keys are auto-imported into the container's GPG keyring on every startup.

### 7. Start the Service

**Using the pre-built image:**

```bash
docker compose up -d
```

**From source:**

```bash
npm run build
docker compose up -d --build
```

### 8. Initialize Restic Repos

Each project needs a one-time restic repository initialization on the remote storage box:

```bash
docker exec backupctl node dist/cli.js restic locaboo init
```

Repeat for each project defined in `projects.yml`.

### 9. Run Health Check

Verify that all systems are connected and operational:

```bash
docker exec backupctl node dist/cli.js health
```

Expected output:

```
Health Check Results:
  Audit DB:        ✓ connected
  Restic (locaboo): ✓ accessible
  Disk space:      ✓ 42 GB free (threshold: 5 GB)
  SSH:             ✓ connected to u123456.your-storagebox.de
```

### 10. Verify with Dry Run

Run a dry-run backup to validate the full configuration without executing any destructive operations:

```bash
docker exec backupctl node dist/cli.js run locaboo --dry-run
```

This validates config loading, database connectivity, restic repo access, SSH connectivity, disk space, and GPG key availability (if encryption is enabled).

## Post-Installation

After installation is complete, verify the system end-to-end:

```bash
# Trigger a real backup
docker exec backupctl node dist/cli.js run locaboo

# Check backup status
docker exec backupctl node dist/cli.js status locaboo

# View audit logs
docker exec backupctl node dist/cli.js logs locaboo --last 1

# Confirm snapshots exist on remote storage
docker exec backupctl node dist/cli.js snapshots locaboo --last 1
```

The cron scheduler starts automatically when the container boots. Backups will run on their configured schedules without further intervention.

## Updating

### Image-based (quick install)

```bash
cd ~/backupctl

# Pull latest image
docker compose pull

# Restart with new image
docker compose up -d

# Run pending migrations (if any)
docker exec backupctl node dist/cli.js config reload

# Verify
docker exec backupctl node dist/cli.js health
```

### From source (management script)

```bash
./scripts/backupctl-manage.sh update
```

This pulls the latest code, rebuilds the container, runs any pending migrations, and performs a health check.

### From source (manual)

```bash
git pull origin main
npm ci
npm run build
docker compose up -d --build
docker exec backupctl npx typeorm migration:run -d dist/db/datasource.js
docker exec backupctl node dist/cli.js health
```

## Uninstalling

### Stop and Remove Containers

```bash
# Stop containers (preserves volumes)
docker compose down

# Stop and remove volumes (deletes audit DB data)
docker compose down -v
```

### Remove Local Data

```bash
# Remove backup data from host
rm -rf /data/backups

# Remove project directory
cd .. && rm -rf backupctl
```

Remote restic snapshots on the Hetzner Storage Box are not affected by uninstalling the local service. To remove remote data, connect to the storage box directly and delete the repository directories.

## What's Next

- **Full config reference** — [Configuration](05-configuration.md) documents every `.env` variable and `projects.yml` field.
- **CLI commands** — [CLI Reference](06-cli-reference.md) covers all 14 commands with flags, arguments, and examples.
- **Quick reference** — [Cheatsheet](10-cheatsheet.md) has copy-paste commands for daily operations.
