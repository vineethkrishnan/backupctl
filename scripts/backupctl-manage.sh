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
  echo "  update             Pull latest, rebuild, migrate, restart"
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

# Audit database
AUDIT_DB_HOST=backupctl-audit-db
AUDIT_DB_PORT=5432
AUDIT_DB_NAME=backup_audit
AUDIT_DB_USER=audit_user
AUDIT_DB_PASSWORD=changeme

# Application
APP_PORT=3100
BACKUP_BASE_DIR=/data/backups
TIMEZONE=Europe/Berlin

# Logging
LOG_DIR=/data/backups/.logs
LOG_MAX_SIZE=10m
LOG_MAX_FILES=5

# Health checks
HEALTH_DISK_MIN_FREE_GB=5

# Restic
# RESTIC_PASSWORD=

# Notifications (global defaults)
# NOTIFICATION_TYPE=slack
# SLACK_WEBHOOK_URL=

# Encryption (global defaults)
# ENCRYPTION_ENABLED=false
# ENCRYPTION_TYPE=gpg
# GPG_RECIPIENT=
# GPG_KEYS_DIR=./gpg-keys
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
    echo "  Generating known_hosts for common storage providers..."
    ssh-keyscan -H your-storage-box.your-server.de >> ssh-keys/known_hosts 2>/dev/null || true
    echo "  Update ssh-keys/known_hosts with your storage box hostname"
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
# See docs/initial/prd.md for full config reference

projects: []
  # - name: myproject
  #   database:
  #     type: postgres
  #     host: localhost
  #     port: 5432
  #     name: mydb
  #     user: myuser
  #     password: ${DB_PASSWORD}
  #   schedule: "0 2 * * *"
  #   retention:
  #     daily: 7
  #     weekly: 4
  #     monthly: 6
  #   restic:
  #     repository: sftp:user@host:/backups/myproject
  #     password: ${RESTIC_PASSWORD}
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
cmd_deploy() {
  local REBUILD=""
  if [ "${1:-}" = "--rebuild" ]; then
    REBUILD="--build --no-cache"
  fi

  echo "=== backupctl deploy ==="

  echo "[1/3] Building and starting containers..."
  if [ -n "$REBUILD" ]; then
    docker compose -f "$COMPOSE_FILE" up -d $REBUILD
  else
    docker compose -f "$COMPOSE_FILE" up -d --build
  fi

  echo "[2/3] Waiting for services to start..."
  sleep 5

  echo "[3/3] Running health check..."
  docker exec backupctl node dist/cli.js health || echo "Health check failed — check logs with: $0 logs"

  echo "=== backupctl deployed ==="
}

# ──────────────────────────────────────────────
# update: Pull latest, rebuild, restart
# ──────────────────────────────────────────────
cmd_update() {
  echo "=== backupctl update ==="

  echo "[1/5] Pulling latest changes..."
  git pull

  echo "[2/5] Installing dependencies..."
  npm ci

  echo "[3/5] Building project..."
  npm run build

  echo "[4/5] Rebuilding containers..."
  docker compose -f "$COMPOSE_FILE" up -d --build

  echo "[5/5] Running health check..."
  sleep 5
  docker exec backupctl node dist/cli.js health || echo "Health check failed — check logs"

  echo "=== backupctl updated ==="
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
  update)     cmd_update ;;
  logs)       cmd_logs ;;
  shell)      cmd_shell ;;
  backup-dir) cmd_backup_dir ;;
  status)     cmd_status ;;
  *)          usage ;;
esac
