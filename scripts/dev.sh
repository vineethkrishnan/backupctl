#!/bin/bash
set -e

# ════════════════════════════════════════════════════════════
# backupctl Development Environment Manager
# ════════════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.dev.yml"
CONTAINER="backupctl-dev"
DB_CONTAINER="backupctl-audit-db"
DATASOURCE="src/domain/audit/infrastructure/persistence/typeorm/data-source.ts"
TYPEORM="npx ts-node -r tsconfig-paths/register ./node_modules/typeorm/cli.js"

cd "$PROJECT_DIR"

# ── Colors ────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

ok()   { echo -e "  ${GREEN}✔${RESET} $1"; }
warn() { echo -e "  ${YELLOW}⚠${RESET} ${YELLOW}$1${RESET}"; }
err()  { echo -e "  ${RED}✘${RESET} ${RED}$1${RESET}"; }
info() { echo -e "  ${CYAN}→${RESET} $1"; }

dc() { docker compose -f "$COMPOSE_FILE" "$@"; }

# ── Helpers ───────────────────────────────────────────────────

is_running() {
  docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${1}$"
}

require_running() {
  if ! is_running "$CONTAINER"; then
    err "Dev container is not running. Start it with: $0 up"
    exit 1
  fi
}

# ════════════════════════════════════════════════════════════
# Commands
# ════════════════════════════════════════════════════════════

# ── up: Start dev environment ────────────────────────────────

cmd_up() {
  echo -e "${BOLD}Starting dev environment...${RESET}"
  echo ""

  if is_running "$CONTAINER"; then
    warn "Dev container is already running"
    info "Use '$0 restart' to restart, or '$0 logs' to tail output"
    return
  fi

  dc up --build -d
  echo ""
  ok "Dev environment started"
  info "App:      http://localhost:${APP_PORT:-3100}"
  info "Audit DB: localhost:${AUDIT_DB_PORT:-5432}"
  info "Logs:     $0 logs"
}

# ── down: Stop dev environment ───────────────────────────────

cmd_down() {
  echo -e "${BOLD}Stopping dev environment...${RESET}"
  dc down
  ok "Dev environment stopped"
}

# ── restart: Restart dev environment ─────────────────────────

cmd_restart() {
  echo -e "${BOLD}Restarting dev environment...${RESET}"
  dc down
  dc up --build -d
  echo ""
  ok "Dev environment restarted"
}

# ── logs: Tail container logs ────────────────────────────────

cmd_logs() {
  local service="${1:-}"

  if [ "$service" = "db" ]; then
    docker logs -f "$DB_CONTAINER"
  elif [ -n "$service" ]; then
    docker logs -f "$service"
  else
    dc logs -f
  fi
}

# ── status: Show container status ────────────────────────────

cmd_status() {
  echo -e "${BOLD}Dev environment status${RESET}"
  echo ""

  if is_running "$CONTAINER"; then
    ok "App container:  ${GREEN}running${RESET}"
  else
    err "App container:  ${RED}stopped${RESET}"
  fi

  if is_running "$DB_CONTAINER"; then
    ok "Audit DB:       ${GREEN}running${RESET}"
  else
    err "Audit DB:       ${RED}stopped${RESET}"
  fi

  echo ""

  if is_running "$CONTAINER"; then
    echo -e "  ${BOLD}Health:${RESET}"
    local health
    health=$(curl -s "http://localhost:${APP_PORT:-3100}/health" 2>/dev/null) || true
    if [ -n "$health" ]; then
      local audit_db
      audit_db=$(echo "$health" | python3 -c "import sys,json; print(json.load(sys.stdin)['checks']['auditDb'])" 2>/dev/null) || audit_db="unknown"
      local uptime
      uptime=$(echo "$health" | python3 -c "import sys,json; print(f\"{json.load(sys.stdin)['uptime']:.0f}s\")" 2>/dev/null) || uptime="unknown"
      info "Audit DB connected: $audit_db"
      info "Uptime: $uptime"
    else
      warn "Could not reach health endpoint"
    fi
  fi
}

# ── shell: Open shell in dev container ───────────────────────

cmd_shell() {
  require_running
  docker exec -it "$CONTAINER" sh
}

# ── cli: Run a CLI command in dev container ──────────────────

cmd_cli() {
  require_running
  docker exec "$CONTAINER" npx ts-node -r tsconfig-paths/register src/cli.ts "$@"
}

# ── test: Run tests in dev container ─────────────────────────

cmd_test() {
  require_running
  local args=("$@")

  if [ ${#args[@]} -eq 0 ]; then
    docker exec "$CONTAINER" npm test
  elif [ "${args[0]}" = "watch" ]; then
    docker exec -it "$CONTAINER" npm test -- --watch
  elif [ "${args[0]}" = "cov" ] || [ "${args[0]}" = "coverage" ]; then
    docker exec "$CONTAINER" npm run test:cov
  elif [ "${args[0]}" = "e2e" ]; then
    docker exec "$CONTAINER" npm run test:e2e
  else
    docker exec "$CONTAINER" npm test -- "${args[@]}"
  fi
}

# ── lint: Run linter in dev container ────────────────────────

cmd_lint() {
  require_running

  if [ "${1:-}" = "fix" ]; then
    docker exec "$CONTAINER" npm run lint
  else
    docker exec "$CONTAINER" npm run lint:check
  fi
}

# ── reset: Destroy volumes and recreate ──────────────────────

cmd_reset() {
  echo -e "${BOLD}Resetting dev environment...${RESET}"
  warn "This will destroy the audit database and all its data"
  echo ""
  echo -ne "  Continue? [y/N]: "
  read -r confirm
  if [[ ! "$confirm" =~ ^[yY]$ ]]; then
    info "Cancelled"
    return
  fi

  dc down -v
  dc up --build -d
  echo ""
  ok "Dev environment reset with fresh database"
}

# ── db:shell: Open psql shell to audit database ──────────────

cmd_db_shell() {
  if ! is_running "$DB_CONTAINER"; then
    err "Audit DB container is not running"
    exit 1
  fi

  docker exec -it "$DB_CONTAINER" psql \
    -U "${AUDIT_DB_USER:-audit_user}" \
    -d "${AUDIT_DB_NAME:-backup_audit}"
}

# ════════════════════════════════════════════════════════════
# Migration Commands
# ════════════════════════════════════════════════════════════

# ── migrate:run: Run pending migrations ──────────────────────

cmd_migrate_run() {
  require_running
  echo -e "${BOLD}Running pending migrations...${RESET}"
  docker exec "$CONTAINER" $TYPEORM migration:run -d "$DATASOURCE"
  ok "Migrations applied"
}

# ── migrate:revert: Revert last migration ────────────────────

cmd_migrate_revert() {
  require_running
  echo -e "${BOLD}Reverting last migration...${RESET}"
  docker exec "$CONTAINER" $TYPEORM migration:revert -d "$DATASOURCE"
  ok "Last migration reverted"
}

# ── migrate:show: Show migration status ──────────────────────

cmd_migrate_show() {
  require_running
  echo -e "${BOLD}Migration status${RESET}"
  echo ""
  docker exec "$CONTAINER" $TYPEORM migration:show -d "$DATASOURCE"
}

# ── migrate:generate: Generate migration from entity diff ────

cmd_migrate_generate() {
  local name="${1:-}"
  if [ -z "$name" ]; then
    err "Usage: $0 migrate:generate <MigrationName>"
    echo ""
    info "Example: $0 migrate:generate AddTagsColumn"
    exit 1
  fi

  require_running
  echo -e "${BOLD}Generating migration: ${name}${RESET}"
  docker exec "$CONTAINER" $TYPEORM migration:generate \
    -d "$DATASOURCE" \
    "src/domain/audit/infrastructure/persistence/typeorm/migrations/${name}"
  echo ""
  ok "Migration generated"
  info "Review the file in src/domain/audit/infrastructure/persistence/typeorm/migrations/"
}

# ── migrate:create: Create empty migration ───────────────────

cmd_migrate_create() {
  local name="${1:-}"
  if [ -z "$name" ]; then
    err "Usage: $0 migrate:create <MigrationName>"
    echo ""
    info "Example: $0 migrate:create AddIndexOnProjectName"
    exit 1
  fi

  require_running
  echo -e "${BOLD}Creating empty migration: ${name}${RESET}"
  docker exec "$CONTAINER" $TYPEORM migration:create \
    "src/domain/audit/infrastructure/persistence/typeorm/migrations/${name}"
  echo ""
  ok "Empty migration created"
  info "Fill in the up() and down() methods"
}

# ════════════════════════════════════════════════════════════
# Usage
# ════════════════════════════════════════════════════════════

usage() {
  echo ""
  echo -e "${BOLD}Usage:${RESET} $0 <command> [options]"
  echo ""
  echo -e "${BOLD}Docker${RESET}"
  echo -e "  ${CYAN}up${RESET}                        Start dev environment (build + hot reload)"
  echo -e "  ${CYAN}down${RESET}                      Stop dev environment"
  echo -e "  ${CYAN}restart${RESET}                   Rebuild and restart"
  echo -e "  ${CYAN}status${RESET}                    Show container status and health"
  echo -e "  ${CYAN}logs${RESET} [db]                 Tail logs (all services, or 'db' for audit DB)"
  echo -e "  ${CYAN}shell${RESET}                     Open shell in dev container"
  echo -e "  ${CYAN}reset${RESET}                     Destroy volumes and recreate (fresh DB)"
  echo ""
  echo -e "${BOLD}App${RESET}"
  echo -e "  ${CYAN}cli${RESET} <command> [args]      Run backupctl CLI command"
  echo -e "  ${CYAN}test${RESET} [watch|cov|e2e]      Run tests"
  echo -e "  ${CYAN}lint${RESET} [fix]                Run linter (fix = autofix)"
  echo ""
  echo -e "${BOLD}Database${RESET}"
  echo -e "  ${CYAN}db:shell${RESET}                  Open psql shell to audit database"
  echo ""
  echo -e "${BOLD}Migrations${RESET}"
  echo -e "  ${CYAN}migrate:run${RESET}               Run pending migrations"
  echo -e "  ${CYAN}migrate:revert${RESET}            Revert the last applied migration"
  echo -e "  ${CYAN}migrate:show${RESET}              Show migration status (applied/pending)"
  echo -e "  ${CYAN}migrate:generate${RESET} <Name>   Generate migration from entity changes"
  echo -e "  ${CYAN}migrate:create${RESET} <Name>     Create an empty migration file"
  echo ""
  echo -e "${BOLD}Examples${RESET}"
  echo -e "  ${DIM}$0 up${RESET}                                   # Start dev environment"
  echo -e "  ${DIM}$0 cli health${RESET}                           # Run health check"
  echo -e "  ${DIM}$0 cli run my-project --dry-run${RESET}         # Dry-run backup"
  echo -e "  ${DIM}$0 test watch${RESET}                           # Tests in watch mode"
  echo -e "  ${DIM}$0 migrate:generate AddTagsColumn${RESET}       # Generate migration"
  echo -e "  ${DIM}$0 migrate:show${RESET}                         # Check migration status"
  echo -e "  ${DIM}$0 db:shell${RESET}                             # Open psql"
  echo -e "  ${DIM}$0 reset${RESET}                                # Fresh database"
  echo ""
  exit 1
}

# ════════════════════════════════════════════════════════════
# Main
# ════════════════════════════════════════════════════════════

# Read select variables from .env (safe — no glob expansion)
if [ -f "$PROJECT_DIR/.env" ]; then
  APP_PORT=$(grep -E '^APP_PORT=' "$PROJECT_DIR/.env" 2>/dev/null | cut -d= -f2 || echo "3100")
  AUDIT_DB_PORT=$(grep -E '^AUDIT_DB_PORT=' "$PROJECT_DIR/.env" 2>/dev/null | cut -d= -f2 || echo "5432")
  AUDIT_DB_USER=$(grep -E '^AUDIT_DB_USER=' "$PROJECT_DIR/.env" 2>/dev/null | cut -d= -f2 || echo "audit_user")
  AUDIT_DB_NAME=$(grep -E '^AUDIT_DB_NAME=' "$PROJECT_DIR/.env" 2>/dev/null | cut -d= -f2 || echo "backup_audit")
fi
APP_PORT="${APP_PORT:-3100}"
AUDIT_DB_PORT="${AUDIT_DB_PORT:-5432}"
AUDIT_DB_USER="${AUDIT_DB_USER:-audit_user}"
AUDIT_DB_NAME="${AUDIT_DB_NAME:-backup_audit}"

COMMAND="${1:-}"
shift 2>/dev/null || true

case "$COMMAND" in
  up)                cmd_up ;;
  down)              cmd_down ;;
  restart)           cmd_restart ;;
  logs)              cmd_logs "$@" ;;
  status)            cmd_status ;;
  shell)             cmd_shell ;;
  reset)             cmd_reset ;;
  cli)               cmd_cli "$@" ;;
  test)              cmd_test "$@" ;;
  lint)              cmd_lint "$@" ;;
  db:shell)          cmd_db_shell ;;
  migrate:run)       cmd_migrate_run ;;
  migrate:revert)    cmd_migrate_revert ;;
  migrate:show)      cmd_migrate_show ;;
  migrate:generate)  cmd_migrate_generate "$@" ;;
  migrate:create)    cmd_migrate_create "$@" ;;
  help|--help|-h)    usage ;;
  *)                 usage ;;
esac
