#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.yml"

cd "$PROJECT_DIR"

usage() {
  echo "Usage: $0 <command> [options]"
  echo ""
  echo "Commands:"
  echo "  setup              Interactive first-time setup"
  echo "  check              Verify prerequisites"
  echo "  deploy [--rebuild] Build and start containers"
  echo "  upgrade            Pull latest, rebuild, migrate, restart"
  echo "  update             Alias for upgrade"
  echo "  logs               Tail container logs"
  echo "  shell              Open shell in backupctl container"
  echo "  backup-dir         Show backup directory sizes"
  echo "  status             Quick status overview"
  echo ""
  exit 1
}

# ──────────────────────────────────────────────
# setup: Interactive first-time setup
# ──────────────────────────────────────────────
cmd_setup() {
  echo "=== backupctl first-time setup ==="

  # Create required directories
  echo "[1/6] Creating directories..."
  mkdir -p config ssh-keys gpg-keys
  echo "  Created: config/ ssh-keys/ gpg-keys/"

  # Generate .env if missing
  echo "[2/6] Checking .env..."
  if [ ! -f .env ]; then
    cat > .env <<'ENVEOF'
# backupctl environment configuration

# Application
APP_PORT=3100
BACKUP_BASE_DIR=/data/backups
TIMEZONE=Europe/Berlin

# Audit database
AUDIT_DB_HOST=backupctl-audit-db
AUDIT_DB_PORT=5432
AUDIT_DB_NAME=backup_audit
AUDIT_DB_USER=audit_user
AUDIT_DB_PASSWORD=changeme

# Hetzner Storage Box
HETZNER_SSH_HOST=u123456.your-storagebox.de
HETZNER_SSH_USER=u123456
HETZNER_SSH_PORT=23
HETZNER_SSH_KEY_PATH=/home/node/.ssh/id_ed25519

# Restic (global defaults)
RESTIC_PASSWORD=changeme

# Retry
BACKUP_RETRY_COUNT=3
BACKUP_RETRY_DELAY_MS=5000

# Notifications (global defaults)
NOTIFICATION_TYPE=none
# SLACK_WEBHOOK_URL=
# WEBHOOK_URL=

# Encryption (global defaults)
ENCRYPTION_ENABLED=false
# ENCRYPTION_TYPE=gpg
# GPG_RECIPIENT=
GPG_KEYS_DIR=/app/gpg-keys

# Logging
LOG_LEVEL=info
LOG_DIR=/data/backups/.logs
LOG_MAX_SIZE=10m
LOG_MAX_FILES=5

# Health checks
HEALTH_DISK_MIN_FREE_GB=5

# Daily summary cron
DAILY_SUMMARY_CRON=0 7 * * *
ENVEOF
    echo "  Created .env with defaults — edit passwords before deploying!"
  else
    echo "  .env already exists, skipping"
  fi

  # SSH key setup
  echo "[3/6] SSH keys..."
  if [ -z "$(ls -A ssh-keys/ 2>/dev/null)" ]; then
    echo "  Place your SSH private key in ssh-keys/ for Hetzner Storage Box access"
    echo "  Example: cp ~/.ssh/hetzner_storage ssh-keys/id_rsa && chmod 600 ssh-keys/id_rsa"
  else
    echo "  SSH keys found in ssh-keys/"
  fi

  # Known hosts
  echo "[4/6] SSH known_hosts..."
  if [ ! -f ssh-keys/known_hosts ]; then
    echo "  No known_hosts found. After configuring .env, scan your storage box:"
    echo "  ssh-keyscan -p \$HETZNER_SSH_PORT -H \$HETZNER_SSH_HOST >> ssh-keys/known_hosts"
  else
    echo "  known_hosts already exists"
  fi

  # GPG keys
  echo "[5/6] GPG keys..."
  if [ -z "$(ls -A gpg-keys/ 2>/dev/null)" ]; then
    echo "  Place GPG public keys in gpg-keys/ for backup encryption"
    echo "  They will be auto-imported on container startup"
  else
    echo "  GPG keys found in gpg-keys/"
  fi

  # Project config
  echo "[6/6] Project configuration..."
  if [ ! -f config/projects.yml ]; then
    cat > config/projects.yml <<'YMLEOF'
# backupctl project configuration
# See docs/15-faq.md for setup guidance

projects: []
  # - name: myproject
  #   enabled: true
  #   cron: "0 2 * * *"
  #   docker_network: myapp_default  # optional — Docker network to reach this DB
  #   database:
  #     type: postgres
  #     host: localhost
  #     port: 5432
  #     name: mydb
  #     user: myuser
  #     password: ${DB_PASSWORD}
  #   compression:
  #     enabled: true
  #   restic:
  #     repository_path: backups/myproject
  #     password: ${RESTIC_PASSWORD}
  #     snapshot_mode: combined
  #   retention:
  #     local_days: 3
  #     keep_daily: 7
  #     keep_weekly: 4
  #     keep_monthly: 6
  #   verification:
  #     enabled: false
YMLEOF
    echo "  Created config/projects.yml template — configure your projects!"
  else
    echo "  config/projects.yml already exists"
  fi

  echo ""
  echo "=== Setup complete ==="
  echo "Next steps:"
  echo "  1. Edit .env with real passwords"
  echo "  2. Add SSH keys to ssh-keys/"
  echo "  3. Configure projects in config/projects.yml"
  echo "  4. Run: $0 check"
  echo "  5. Run: $0 deploy"
}

# ──────────────────────────────────────────────
# check: Verify prerequisites
# ──────────────────────────────────────────────
cmd_check() {
  echo "=== backupctl prerequisite check ==="
  ERRORS=0

  # Docker
  echo -n "  Docker:         "
  if command -v docker &>/dev/null; then
    echo "OK ($(docker --version | head -1))"
  else
    echo "MISSING"
    ERRORS=$((ERRORS + 1))
  fi

  # Docker Compose
  echo -n "  Docker Compose: "
  if docker compose version &>/dev/null; then
    echo "OK ($(docker compose version --short))"
  else
    echo "MISSING"
    ERRORS=$((ERRORS + 1))
  fi

  # .env file
  echo -n "  .env:           "
  if [ -f .env ]; then
    echo "OK"
  else
    echo "MISSING — run '$0 setup'"
    ERRORS=$((ERRORS + 1))
  fi

  # Config YAML
  echo -n "  projects.yml:   "
  if [ -f config/projects.yml ]; then
    echo "OK"
  else
    echo "MISSING — run '$0 setup'"
    ERRORS=$((ERRORS + 1))
  fi

  # SSH keys
  echo -n "  SSH keys:       "
  if [ -n "$(ls -A ssh-keys/ 2>/dev/null)" ]; then
    echo "OK"
  else
    echo "MISSING — place SSH keys in ssh-keys/"
    ERRORS=$((ERRORS + 1))
  fi

  # GPG keys
  echo -n "  GPG keys:       "
  if [ -n "$(ls -A gpg-keys/ 2>/dev/null)" ]; then
    echo "OK"
  else
    echo "NONE (encryption disabled)"
  fi

  # Disk space
  echo -n "  Disk space:     "
  AVAIL_GB=$(df -BG / | tail -1 | awk '{print $4}' | tr -d 'G')
  if [ "$AVAIL_GB" -ge 5 ] 2>/dev/null; then
    echo "OK (${AVAIL_GB}G available)"
  else
    echo "LOW (${AVAIL_GB}G available, recommend >= 5G)"
    ERRORS=$((ERRORS + 1))
  fi

  echo ""
  if [ "$ERRORS" -eq 0 ]; then
    echo "All checks passed!"
  else
    echo "$ERRORS check(s) failed — fix issues before deploying"
    exit 1
  fi
}

# ──────────────────────────────────────────────
# deploy: Build and start containers
# ──────────────────────────────────────────────
connect_project_networks() {
  local container="${1:-backupctl}"
  local config_file="$PROJECT_DIR/config/projects.yml"
  [ -f "$config_file" ] || return 0

  local networks
  networks=$(grep 'docker_network:' "$config_file" 2>/dev/null \
    | awk '{print $2}' | tr -d '"' | tr -d "'") || return 0

  for network in $networks; do
    [ -z "$network" ] && continue

    if ! docker network ls --format '{{.Name}}' | grep -q "^${network}$"; then
      echo "  WARNING: Docker network '$network' not found — skipping"
      continue
    fi

    if docker inspect "$container" --format '{{json .NetworkSettings.Networks}}' 2>/dev/null \
        | grep -q "\"${network}\""; then
      continue
    fi

    docker network connect "$network" "$container" 2>/dev/null \
      && echo "  Connected to network: $network" \
      || echo "  WARNING: Failed to connect to network: $network"
  done
}

cmd_deploy() {
  local REBUILD=""
  if [ "${1:-}" = "--rebuild" ]; then
    REBUILD="--build --no-cache"
  fi

  echo "=== backupctl deploy ==="

  # Ensure backup base directory exists with correct ownership (node user = UID 1000)
  local backup_dir
  backup_dir=$(grep -E '^BACKUP_BASE_DIR=' .env 2>/dev/null | cut -d= -f2 || echo "/data/backups")
  backup_dir="${backup_dir:-/data/backups}"
  if [ ! -d "$backup_dir" ]; then
    echo "Creating backup directory: $backup_dir"
    sudo mkdir -p "$backup_dir" && sudo chown 1000:1000 "$backup_dir"
  else
    local dir_owner
    dir_owner=$(stat -c '%u' "$backup_dir" 2>/dev/null || stat -f '%u' "$backup_dir" 2>/dev/null)
    if [ "$dir_owner" != "1000" ]; then
      echo "Fixing ownership of $backup_dir for container's node user (UID 1000)..."
      sudo chown -R 1000:1000 "$backup_dir"
    fi
  fi

  echo "[1/5] Building and starting containers..."
  if [ -n "$REBUILD" ]; then
    docker compose -f "$COMPOSE_FILE" up -d $REBUILD
  else
    docker compose -f "$COMPOSE_FILE" up -d --build
  fi

  echo "[2/5] Connecting project Docker networks..."
  connect_project_networks backupctl

  echo "[3/5] Waiting for services to start..."
  sleep 5

  echo "[4/5] Running database migrations (migrator service)..."
  if ! docker compose -f "$COMPOSE_FILE" --profile migrate run --rm --build migrator; then
    echo "ERROR: Database migrations failed. Rolling back..."
    docker compose -f "$COMPOSE_FILE" down
    echo "Fix the migration and re-run: $0 deploy"
    exit 1
  fi

  echo "[5/5] Running health check..."
  docker exec backupctl node dist/cli.js health || echo "Health check failed — check logs with: $0 logs"

  echo "=== backupctl deployed ==="
}

# ──────────────────────────────────────────────
# upgrade: Pull latest, rebuild, restart
# ──────────────────────────────────────────────
cmd_upgrade() {
  echo "=== backupctl upgrade ==="

  echo "[1/7] Pulling latest changes..."
  git pull

  echo "[2/7] Rebuilding containers (includes npm ci + build)..."
  docker compose -f "$COMPOSE_FILE" up -d --build

  echo "[3/7] Connecting project Docker networks..."
  connect_project_networks backupctl

  echo "[4/7] Waiting for services to start..."
  sleep 5

  echo "[5/7] Running database migrations (migrator service)..."
  if ! docker compose -f "$COMPOSE_FILE" --profile migrate run --rm --build migrator; then
    echo "ERROR: Database migrations failed. Check logs with: $0 logs"
    echo "The previous container version may still be running. Fix the migration and re-run: $0 upgrade"
    exit 1
  fi

  echo "[6/7] Running health check..."
  docker exec backupctl node dist/cli.js health || echo "Health check failed — check logs"

  # Clear upgrade cache so the next CLI check fetches fresh release info
  echo "[7/7] Clearing upgrade check cache..."
  BACKUP_BASE_DIR=$(grep -oP '(?<=BACKUP_BASE_DIR=).+' "$PROJECT_DIR/.env" 2>/dev/null || echo "/data/backups")
  rm -f "${BACKUP_BASE_DIR}/.upgrade-info"

  echo "=== backupctl upgraded ==="
}

# ──────────────────────────────────────────────
# logs: Tail container logs
# ──────────────────────────────────────────────
cmd_logs() {
  docker compose -f "$COMPOSE_FILE" logs -f --tail=100
}

# ──────────────────────────────────────────────
# shell: Open shell in container
# ──────────────────────────────────────────────
cmd_shell() {
  docker exec -it backupctl /bin/sh
}

# ──────────────────────────────────────────────
# backup-dir: Show backup directory sizes
# ──────────────────────────────────────────────
cmd_backup_dir() {
  echo "=== Backup directory sizes ==="
  BACKUP_DIR=$(grep -E '^BACKUP_BASE_DIR=' .env 2>/dev/null | cut -d= -f2 || echo "/data/backups")
  BACKUP_DIR="${BACKUP_DIR:-/data/backups}"

  if [ -d "$BACKUP_DIR" ]; then
    du -sh "$BACKUP_DIR"/*/ 2>/dev/null || echo "No project directories found"
    echo ""
    echo "Total:"
    du -sh "$BACKUP_DIR"
  else
    echo "Backup directory not found: $BACKUP_DIR"
    echo "Check BACKUP_BASE_DIR in .env"
  fi
}

# ──────────────────────────────────────────────
# status: Quick status overview
# ──────────────────────────────────────────────
cmd_status() {
  echo "=== backupctl status ==="

  echo ""
  echo "Containers:"
  docker compose -f "$COMPOSE_FILE" ps

  echo ""
  echo "Backup status:"
  docker exec backupctl node dist/cli.js status 2>/dev/null || echo "Container not running"

  echo ""
  echo "Disk usage:"
  cmd_backup_dir
}

# ──────────────────────────────────────────────
# Command router
# ──────────────────────────────────────────────
case "${1:-}" in
  setup)      cmd_setup ;;
  check)      cmd_check ;;
  deploy)     cmd_deploy "$2" ;;
  upgrade)    cmd_upgrade ;;
  update)     cmd_upgrade ;;
  logs)       cmd_logs ;;
  shell)      cmd_shell ;;
  backup-dir) cmd_backup_dir ;;
  status)     cmd_status ;;
  *)          usage ;;
esac
