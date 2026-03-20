#!/bin/bash
set -e

# ════════════════════════════════════════════════════════════
# backupctl Installation Wizard
# Zero-file-edit interactive setup
# ════════════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# ── Colors & Formatting ─────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

CHECKMARK="${GREEN}✔${RESET}"
CROSSMARK="${RED}✘${RESET}"
ARROW="${CYAN}→${RESET}"
WARNING="${YELLOW}⚠${RESET}"

# ── State ────────────────────────────────────────────────────

TOTAL_STEPS=13
ENV_VARS=""
PROJECTS=()
PROJECT_COUNT=0

# ── Cleanup on exit ──────────────────────────────────────────

cleanup() {
  local exit_code=$?
  if [ $exit_code -ne 0 ] && [ $exit_code -ne 130 ]; then
    echo ""
    print_error "Installation encountered an error (exit code: $exit_code)"
  fi
}
trap cleanup EXIT

trap 'echo ""; echo ""; print_warning "Installation cancelled by user."; exit 130' INT

# ════════════════════════════════════════════════════════════
# Helper Functions
# ════════════════════════════════════════════════════════════

print_header() {
  local text="$1"
  local width=61
  local padding=$(( (width - ${#text}) / 2 ))
  local pad_str=""
  for ((i=0; i<padding; i++)); do pad_str+=" "; done

  echo ""
  echo -e "${BOLD}${CYAN}╔═══════════════════════════════════════════════════════════════╗${RESET}"
  echo -e "${BOLD}${CYAN}║${RESET}${BOLD}${pad_str}${text}${pad_str}$(( (width - ${#text}) % 2 == 1 )) ${BOLD}${CYAN}║${RESET}" | sed 's/0 ║/ ║/;s/1 ║/  ║/'
  echo -e "${BOLD}${CYAN}╚═══════════════════════════════════════════════════════════════╝${RESET}"
  echo ""
}

print_step() {
  local step=$1
  local text="$2"
  echo ""
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "  ${BOLD}[${step}/${TOTAL_STEPS}]${RESET} ${BOLD}${text}${RESET}"
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo ""
}

print_success() {
  echo -e "  ${CHECKMARK} $1"
}

print_warning() {
  echo -e "  ${WARNING} ${YELLOW}$1${RESET}"
}

print_error() {
  echo -e "  ${CROSSMARK} ${RED}$1${RESET}"
}

print_info() {
  echo -e "  ${ARROW} $1"
}

print_dim() {
  echo -e "  ${DIM}$1${RESET}"
}

# Read input with a default value
ask() {
  local prompt="$1"
  local default="$2"
  local result

  if [ -n "$default" ]; then
    echo -ne "  ${prompt} ${DIM}[${default}]${RESET}: " >/dev/tty
  else
    echo -ne "  ${prompt}: " >/dev/tty
  fi

  read -r result </dev/tty
  if [ -z "$result" ]; then
    result="$default"
  fi
  echo "$result"
}

# Read a password (hidden input)
ask_password() {
  local prompt="$1"
  local result

  echo -ne "  ${prompt}: " >/dev/tty
  read -rs result </dev/tty
  echo "" >/dev/tty
  echo "$result"
}

# Yes/no prompt with default
ask_yn() {
  local prompt="$1"
  local default="$2"
  local hint result

  if [ "$default" = "y" ]; then
    hint="Y/n"
  else
    hint="y/N"
  fi

  echo -ne "  ${prompt} ${DIM}[${hint}]${RESET}: "
  read -r result

  if [ -z "$result" ]; then
    result="$default"
  fi

  case "$result" in
    [yY]|[yY][eE][sS]) return 0 ;;
    *) return 1 ;;
  esac
}

# Generate a secure random password
generate_password() {
  openssl rand -base64 32 | tr -d '/+=' | head -c 32
}

# Validate input is not empty
validate_not_empty() {
  local value="$1"
  local field_name="$2"

  if [ -z "$value" ]; then
    echo -e "  ${CROSSMARK} ${RED}${field_name} cannot be empty${RESET}" >/dev/tty
    return 1
  fi
  return 0
}

# Validate port number
validate_port() {
  local port="$1"
  if ! [[ "$port" =~ ^[0-9]+$ ]] || [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
    echo -e "  ${CROSSMARK} ${RED}Invalid port number: ${port}${RESET}" >/dev/tty
    return 1
  fi
  return 0
}

# Validate project name (lowercase, hyphens, underscores)
validate_project_name() {
  local name="$1"
  if ! [[ "$name" =~ ^[a-z][a-z0-9_-]*$ ]]; then
    print_error "Project name must be lowercase, start with a letter, and contain only letters, numbers, hyphens, underscores"
    return 1
  fi
  return 0
}

# Convert project name to env-safe uppercase key
project_env_key() {
  echo "$1" | tr '[:lower:]-' '[:upper:]_'
}

# Append a key=value to ENV_VARS accumulator
env_set() {
  ENV_VARS+="$1=$2"$'\n'
}

# Ask for a value in a loop until validation passes
ask_required() {
  local prompt="$1"
  local default="$2"
  local field_name="$3"
  local value

  while true; do
    value=$(ask "$prompt" "$default")
    if validate_not_empty "$value" "$field_name"; then
      echo "$value"
      return
    fi
  done
}

ask_port() {
  local prompt="$1"
  local default="$2"
  local value

  while true; do
    value=$(ask "$prompt" "$default")
    if validate_port "$value"; then
      echo "$value"
      return
    fi
  done
}

# ════════════════════════════════════════════════════════════
# Step 0: Welcome Screen
# ════════════════════════════════════════════════════════════

welcome() {
  clear 2>/dev/null || true
  echo ""
  echo -e "${BOLD}${CYAN}╔═══════════════════════════════════════════════════════════════╗${RESET}"
  echo -e "${BOLD}${CYAN}║                                                               ║${RESET}"
  echo -e "${BOLD}${CYAN}║            ${BOLD}backupctl Installation Wizard${CYAN}                      ║${RESET}"
  echo -e "${BOLD}${CYAN}║       Backup Orchestration — Databases, Files, or Both       ║${RESET}"
  echo -e "${BOLD}${CYAN}║                                                               ║${RESET}"
  echo -e "${BOLD}${CYAN}╚═══════════════════════════════════════════════════════════════╝${RESET}"
  echo ""
  echo -e "  This wizard will configure a complete backupctl installation."
  echo -e "  It will generate all required configuration files interactively."
  echo ""
  echo -e "  ${DIM}Files that will be created:${RESET}"
  echo -e "    ${ARROW} .env                  ${DIM}(secrets & global settings)${RESET}"
  echo -e "    ${ARROW} config/projects.yml   ${DIM}(project backup definitions)${RESET}"
  echo -e "    ${ARROW} ssh-keys/             ${DIM}(SSH keypair for storage box)${RESET}"
  echo -e "    ${ARROW} gpg-keys/             ${DIM}(GPG keys for encryption)${RESET}"
  echo ""

  # Check for existing files
  local existing_files=()
  [ -f .env ] && existing_files+=(".env")
  [ -f config/projects.yml ] && existing_files+=("config/projects.yml")

  if [ ${#existing_files[@]} -gt 0 ]; then
    print_warning "Existing configuration detected:"
    for f in "${existing_files[@]}"; do
      echo -e "    ${DIM}${f}${RESET}"
    done
    echo ""
    if ! ask_yn "Continue? Existing files will be backed up before overwriting" "y"; then
      echo ""
      print_info "Installation cancelled."
      exit 0
    fi

    # Backup existing files
    local ts
    ts=$(date +%Y%m%d_%H%M%S)
    for f in "${existing_files[@]}"; do
      cp "$f" "${f}.bak.${ts}"
      print_dim "Backed up ${f} → ${f}.bak.${ts}"
    done
    echo ""
  fi

  echo -ne "  Press ${BOLD}Enter${RESET} to begin installation... "
  read -r
}

# ════════════════════════════════════════════════════════════
# Step 1: Prerequisites Check
# ════════════════════════════════════════════════════════════

step_prerequisites() {
  print_step 1 "Prerequisites Check"

  local errors=0

  # Docker
  echo -ne "  Checking Docker...            "
  if command -v docker &>/dev/null; then
    local docker_ver
    docker_ver=$(docker --version 2>/dev/null | head -1)
    echo -e "${CHECKMARK} ${DIM}${docker_ver}${RESET}"
  else
    echo -e "${CROSSMARK} ${RED}Not installed${RESET}"
    errors=$((errors + 1))
  fi

  # Docker Compose
  echo -ne "  Checking Docker Compose...    "
  if docker compose version &>/dev/null 2>&1; then
    local compose_ver
    compose_ver=$(docker compose version --short 2>/dev/null)
    echo -e "${CHECKMARK} ${DIM}v${compose_ver}${RESET}"
  else
    echo -e "${CROSSMARK} ${RED}Not installed${RESET}"
    errors=$((errors + 1))
  fi

  # Git
  echo -ne "  Checking git...               "
  if command -v git &>/dev/null; then
    local git_ver
    git_ver=$(git --version 2>/dev/null)
    echo -e "${CHECKMARK} ${DIM}${git_ver}${RESET}"
  else
    echo -e "${CROSSMARK} ${RED}Not installed${RESET}"
    errors=$((errors + 1))
  fi

  # OpenSSL (needed for password generation)
  echo -ne "  Checking openssl...           "
  if command -v openssl &>/dev/null; then
    echo -e "${CHECKMARK}"
  else
    echo -e "${WARNING} ${YELLOW}Not found (password generation will use /dev/urandom)${RESET}"
  fi

  # ssh-keygen
  echo -ne "  Checking ssh-keygen...        "
  if command -v ssh-keygen &>/dev/null; then
    echo -e "${CHECKMARK}"
  else
    echo -e "${WARNING} ${YELLOW}Not found (SSH key generation unavailable)${RESET}"
  fi

  echo ""

  if [ "$errors" -gt 0 ]; then
    print_error "Missing ${errors} critical prerequisite(s). Install them and re-run this script."
    exit 1
  fi

  print_success "All prerequisites satisfied"
}

# ════════════════════════════════════════════════════════════
# Step 2: Application Settings
# ════════════════════════════════════════════════════════════

step_app_settings() {
  print_step 2 "Application Settings"

  APP_PORT=$(ask_port "HTTP port" "3100")
  TIMEZONE=$(ask_required "Timezone" "Europe/Berlin" "Timezone")
  BACKUP_BASE_DIR=$(ask_required "Backup base directory" "/data/backups" "Backup base dir")
  LOG_LEVEL=$(ask "Log level (debug/info/warn/error)" "info")
  HEALTH_DISK_MIN_FREE_GB=$(ask "Minimum free disk space (GB) for health check" "5")

  echo ""
  print_success "Application settings configured"
}

# ════════════════════════════════════════════════════════════
# Step 3: Audit Database
# ════════════════════════════════════════════════════════════

step_audit_db() {
  print_step 3 "Audit Database (PostgreSQL)"

  print_dim "The audit database stores backup run history and progress."
  print_dim "Default host 'backupctl-audit-db' is the Docker container name."
  echo ""

  AUDIT_DB_HOST=$(ask_required "Database host" "backupctl-audit-db" "DB host")
  AUDIT_DB_PORT=$(ask_port "Database port" "5432")
  AUDIT_DB_NAME=$(ask_required "Database name" "backup_audit" "DB name")
  AUDIT_DB_USER=$(ask_required "Database user" "audit_user" "DB user")

  echo ""
  if ask_yn "Auto-generate a secure password for the audit database?" "y"; then
    AUDIT_DB_PASSWORD=$(generate_password)
    print_success "Password generated: ${DIM}(stored in .env)${RESET}"
  else
    while true; do
      AUDIT_DB_PASSWORD=$(ask_password "Database password")
      if validate_not_empty "$AUDIT_DB_PASSWORD" "Database password"; then
        break
      fi
    done
  fi

  echo ""
  print_success "Audit database configured"
}

# ════════════════════════════════════════════════════════════
# Step 4: Hetzner Storage Box
# ════════════════════════════════════════════════════════════

step_hetzner() {
  print_step 4 "Hetzner Storage Box (Remote Storage)"

  print_dim "Backups are synced to a Hetzner Storage Box via restic over SFTP."
  echo ""

  while true; do
    HETZNER_SSH_HOST=$(ask "Storage Box SSH host (e.g., u123456.your-storagebox.de)" "")
    if validate_not_empty "$HETZNER_SSH_HOST" "SSH host"; then
      break
    fi
  done

  while true; do
    HETZNER_SSH_USER=$(ask "Storage Box SSH user (e.g., u123456)" "")
    if validate_not_empty "$HETZNER_SSH_USER" "SSH user"; then
      break
    fi
  done

  HETZNER_SSH_PORT=$(ask_port "Storage Box SSH port" "23")

  # SSH key generation
  echo ""
  mkdir -p ssh-keys

  SSH_KEY_TYPE=$(ask "SSH key type" "ed25519")

  local key_file="ssh-keys/id_${SSH_KEY_TYPE}"

  if [ -f "$key_file" ]; then
    print_warning "SSH key already exists at ${key_file}"
    if ! ask_yn "Overwrite existing SSH key?" "n"; then
      print_info "Keeping existing SSH key"
    else
      generate_ssh_key "$SSH_KEY_TYPE" "$key_file"
    fi
  else
    if ask_yn "Generate SSH keypair for the storage box?" "y"; then
      generate_ssh_key "$SSH_KEY_TYPE" "$key_file"
    else
      print_info "Place your SSH key manually in ssh-keys/"
    fi
  fi

  # Create SSH config for port 23
  if [ ! -f ssh-keys/config ] || ! grep -q "Host.*storagebox" ssh-keys/config 2>/dev/null; then
    cat > ssh-keys/config <<SSHCONF
Host ${HETZNER_SSH_HOST}
    User ${HETZNER_SSH_USER}
    Port ${HETZNER_SSH_PORT}
    IdentityFile /home/node/.ssh/id_${SSH_KEY_TYPE}
    StrictHostKeyChecking accept-new
SSHCONF
    chmod 600 ssh-keys/config
    print_success "SSH config created"
  fi

  # known_hosts scanning
  echo ""
  if ask_yn "Scan the storage box SSH host key now?" "y"; then
    echo -ne "  Scanning ${HETZNER_SSH_HOST}..."
    if ssh-keyscan -p "$HETZNER_SSH_PORT" -H "$HETZNER_SSH_HOST" >> ssh-keys/known_hosts 2>/dev/null; then
      echo -e " ${CHECKMARK}"
      print_success "Host key added to ssh-keys/known_hosts"
    else
      echo -e " ${CROSSMARK}"
      print_warning "Could not scan host key. You may need to add it manually."
    fi
  fi

  # Show public key
  if [ -f "${key_file}.pub" ]; then
    echo ""
    echo -e "  ${BOLD}Public key to install on the storage box:${RESET}"
    echo -e "  ${DIM}─────────────────────────────────────────────────────${RESET}"
    echo -e "  ${CYAN}$(cat "${key_file}.pub")${RESET}"
    echo -e "  ${DIM}─────────────────────────────────────────────────────${RESET}"
    echo ""
    print_info "Install via: ssh-copy-id -p ${HETZNER_SSH_PORT} -i ${key_file}.pub ${HETZNER_SSH_USER}@${HETZNER_SSH_HOST}"
    echo ""
  fi

  # Test SSH connection
  if ask_yn "Test SSH connection to the storage box?" "n"; then
    echo -ne "  Connecting to ${HETZNER_SSH_HOST}..."
    if ssh -i "$key_file" -p "$HETZNER_SSH_PORT" -o ConnectTimeout=10 -o StrictHostKeyChecking=no \
       "${HETZNER_SSH_USER}@${HETZNER_SSH_HOST}" "echo ok" &>/dev/null; then
      echo -e " ${CHECKMARK}"
      print_success "SSH connection successful"
    else
      echo -e " ${CROSSMARK}"
      print_warning "SSH connection failed. Ensure the public key is installed on the storage box."
    fi
  fi

  echo ""
  print_success "Hetzner Storage Box configured"
}

generate_ssh_key() {
  local key_type="$1"
  local key_file="$2"

  echo -ne "  Generating ${key_type} keypair..."
  ssh-keygen -t "$key_type" -f "$key_file" -N "" -C "backupctl@$(hostname)" -q
  chmod 600 "$key_file"
  chmod 644 "${key_file}.pub"
  echo -e " ${CHECKMARK}"
  print_success "SSH keypair generated at ${key_file}"
}

# ════════════════════════════════════════════════════════════
# Step 5: Restic Configuration
# ════════════════════════════════════════════════════════════

step_restic() {
  print_step 5 "Restic Configuration"

  print_dim "Restic is used for encrypted, deduplicated remote backups."
  echo ""

  if ask_yn "Auto-generate a global restic password?" "y"; then
    RESTIC_PASSWORD=$(generate_password)
    print_success "Restic password generated: ${DIM}(stored in .env)${RESET}"
  else
    while true; do
      RESTIC_PASSWORD=$(ask_password "Global restic password")
      if validate_not_empty "$RESTIC_PASSWORD" "Restic password"; then
        break
      fi
    done
  fi

  echo ""
  BACKUP_RETRY_COUNT=$(ask "Backup retry count" "3")
  BACKUP_RETRY_DELAY_MS=$(ask "Backup retry delay (ms)" "5000")

  echo ""
  print_success "Restic configured"
}

# ════════════════════════════════════════════════════════════
# Step 6: Notification Defaults
# ════════════════════════════════════════════════════════════

step_notifications() {
  print_step 6 "Notification Defaults"

  print_dim "Configure how backupctl sends backup success/failure notifications."
  echo ""
  echo -e "  ${DIM}Options: slack, email, webhook, none${RESET}"

  while true; do
    NOTIFICATION_TYPE=$(ask "Default notification type" "none")
    case "$NOTIFICATION_TYPE" in
      slack|email|webhook|none) break ;;
      *) print_error "Must be one of: slack, email, webhook, none" ;;
    esac
  done

  SLACK_WEBHOOK_URL=""
  SMTP_HOST=""
  SMTP_PORT=""
  SMTP_SECURE=""
  SMTP_USER=""
  SMTP_PASSWORD=""
  SMTP_FROM=""
  SMTP_TO=""
  WEBHOOK_URL=""

  case "$NOTIFICATION_TYPE" in
    slack)
      echo ""
      while true; do
        SLACK_WEBHOOK_URL=$(ask "Slack webhook URL" "")
        if validate_not_empty "$SLACK_WEBHOOK_URL" "Slack webhook URL"; then break; fi
      done
      ;;
    email)
      echo ""
      SMTP_HOST=$(ask_required "SMTP host" "smtp.gmail.com" "SMTP host")
      SMTP_PORT=$(ask_port "SMTP port" "587")
      if ask_yn "Use TLS/SSL?" "y"; then
        SMTP_SECURE="true"
      else
        SMTP_SECURE="false"
      fi
      SMTP_USER=$(ask_required "SMTP username" "" "SMTP user")
      SMTP_PASSWORD=$(ask_password "SMTP password")
      SMTP_FROM=$(ask_required "From address" "" "From address")
      SMTP_TO=$(ask_required "To address(es), comma-separated" "" "To address")
      ;;
    webhook)
      echo ""
      while true; do
        WEBHOOK_URL=$(ask "Webhook URL" "")
        if validate_not_empty "$WEBHOOK_URL" "Webhook URL"; then break; fi
      done
      ;;
  esac

  echo ""
  DAILY_SUMMARY_CRON=$(ask "Daily summary cron schedule" "0 8 * * *")

  echo ""
  print_success "Notifications configured (${NOTIFICATION_TYPE})"
}

# ════════════════════════════════════════════════════════════
# Step 7: Encryption Defaults
# ════════════════════════════════════════════════════════════

step_encryption() {
  print_step 7 "Encryption Defaults"

  print_dim "Backup dumps can be encrypted with GPG before remote sync."
  echo ""

  ENCRYPTION_ENABLED="false"
  ENCRYPTION_TYPE=""
  GPG_RECIPIENT=""

  if ask_yn "Enable encryption by default?" "n"; then
    ENCRYPTION_ENABLED="true"
    ENCRYPTION_TYPE="gpg"

    while true; do
      GPG_RECIPIENT=$(ask "GPG recipient (email or key ID)" "")
      if validate_not_empty "$GPG_RECIPIENT" "GPG recipient"; then break; fi
    done

    mkdir -p gpg-keys

    echo ""
    if ask_yn "Copy a GPG public key file into gpg-keys/ now?" "n"; then
      while true; do
        GPG_KEY_PATH=$(ask "Path to GPG public key file" "")
        if [ -f "$GPG_KEY_PATH" ]; then
          local real_src real_dest
          real_src="$(cd "$(dirname "$GPG_KEY_PATH")" && pwd)/$(basename "$GPG_KEY_PATH")"
          real_dest="$(cd gpg-keys && pwd)/$(basename "$GPG_KEY_PATH")"
          if [ "$real_src" = "$real_dest" ]; then
            print_success "$(basename "$GPG_KEY_PATH") is already in gpg-keys/"
          else
            cp "$GPG_KEY_PATH" gpg-keys/
            print_success "Copied $(basename "$GPG_KEY_PATH") to gpg-keys/"
          fi
          break
        else
          print_error "File not found: ${GPG_KEY_PATH}"
        fi
      done
    else
      print_info "Place GPG public keys in gpg-keys/ before running encrypted backups"
    fi
  fi

  echo ""
  print_success "Encryption configured (enabled: ${ENCRYPTION_ENABLED})"
}

# ════════════════════════════════════════════════════════════
# Step 8: Project Configuration
# ════════════════════════════════════════════════════════════

step_projects() {
  print_step 8 "Project Configuration"

  print_dim "Define backup projects. Each project has its own database, schedule,"
  print_dim "retention policy, and optional overrides for notifications/encryption."
  echo ""

  PROJECTS=()
  PROJECT_COUNT=0

  if ! ask_yn "Add a project now?" "y"; then
    print_info "No projects configured. Add them later in config/projects.yml"
    return
  fi

  while true; do
    add_project
    echo ""
    if ! ask_yn "Add another project?" "n"; then
      break
    fi
  done

  echo ""
  print_success "${PROJECT_COUNT} project(s) configured"
}

add_project() {
  PROJECT_COUNT=$((PROJECT_COUNT + 1))
  echo ""
  echo -e "  ${BOLD}── Project #${PROJECT_COUNT} ──${RESET}"
  echo ""

  # Project name
  local proj_name
  while true; do
    proj_name=$(ask "Project name (lowercase, hyphens ok)" "")
    if validate_not_empty "$proj_name" "Project name" && validate_project_name "$proj_name"; then
      break
    fi
  done

  local proj_enabled="true"
  if ! ask_yn "Enable this project?" "y"; then
    proj_enabled="false"
  fi

  # Schedule
  echo ""
  print_dim "Cron examples: '0 2 * * *' (daily 2am), '0 */6 * * *' (every 6h), '0 3 * * 0' (weekly Sun 3am)"
  local proj_cron
  proj_cron=$(ask "Cron schedule" "0 2 * * *")

  local proj_timeout
  proj_timeout=$(ask "Timeout minutes (empty = no timeout)" "")

  # Docker network
  echo ""
  echo -e "  ${BOLD}Docker Network:${RESET}"
  print_dim "If this project's database runs in a Docker container on another network,"
  print_dim "specify the network name so backupctl can reach it. Leave empty if the"
  print_dim "database is on the host machine or already reachable."

  local available_networks
  available_networks=$(docker network ls --format '{{.Name}}' 2>/dev/null | grep -v '^bridge$\|^host$\|^none$' | sort)
  if [ -n "$available_networks" ]; then
    echo ""
    print_dim "Available Docker networks:"
    while IFS= read -r net; do
      echo -e "    ${DIM}• ${net}${RESET}"
    done <<< "$available_networks"
  fi

  echo ""
  local proj_docker_network
  proj_docker_network=$(ask "Docker network (empty = host/default)" "")

  # Backup scope
  echo ""
  echo -e "  ${BOLD}What to back up:${RESET}"
  print_dim "  1) Database + files  — dump a database and sync asset directories"
  print_dim "  2) Database only     — dump a database (no asset files)"
  print_dim "  3) Files only        — sync asset directories (no database dump)"

  local proj_backup_type
  while true; do
    proj_backup_type=$(ask "Backup type (1/2/3)" "1")
    case "$proj_backup_type" in
      1|2|3) break ;;
      *) print_error "Must be 1, 2, or 3" ;;
    esac
  done

  local proj_has_db="false"
  local proj_has_assets="false"
  case "$proj_backup_type" in
    1) proj_has_db="true"; proj_has_assets="true" ;;
    2) proj_has_db="true" ;;
    3) proj_has_assets="true" ;;
  esac

  local proj_env_key
  proj_env_key=$(project_env_key "$proj_name")

  # Database (when selected)
  local proj_db_type="" proj_db_host="" proj_db_port="" proj_db_name="" proj_db_user="" proj_db_password=""
  if [ "$proj_has_db" = "true" ]; then
    echo ""
    echo -e "  ${BOLD}Database:${RESET}"

    while true; do
      proj_db_type=$(ask "Database type (postgres/mysql/mongodb)" "postgres")
      case "$proj_db_type" in
        postgres|mysql|mongodb) break ;;
        *) print_error "Must be one of: postgres, mysql, mongodb" ;;
      esac
    done

    local default_port
    case "$proj_db_type" in
      postgres) default_port="5432" ;;
      mysql)    default_port="3306" ;;
      mongodb)  default_port="27017" ;;
    esac

    proj_db_host=$(ask_required "Database host" "" "Database host")
    proj_db_port=$(ask_port "Database port" "$default_port")
    proj_db_name=$(ask_required "Database name" "" "Database name")
    proj_db_user=$(ask_required "Database user" "" "Database user")

    echo ""
    while true; do
      proj_db_password=$(ask_password "Database password")
      if validate_not_empty "$proj_db_password" "Database password"; then break; fi
    done
    print_success "Password stored as ${proj_env_key}_DB_PASSWORD in .env"
  fi

  # Assets
  echo ""
  local proj_assets
  if [ "$proj_has_assets" = "true" ]; then
    if [ "$proj_backup_type" = "3" ]; then
      while true; do
        proj_assets=$(ask "Asset paths to back up (comma-separated)" "")
        if validate_not_empty "$proj_assets" "At least one asset path is required for files-only backup"; then break; fi
      done
    else
      proj_assets=$(ask "Asset paths to back up (comma-separated)" "")
    fi
  else
    proj_assets=""
  fi

  # Restic
  echo ""
  echo -e "  ${BOLD}Restic:${RESET}"
  local proj_restic_path
  print_dim "Use a relative path (no leading /) for Hetzner Storage Box SFTP"
  proj_restic_path=$(ask "Restic repository path on storage box" "backups/${proj_name}")

  local proj_restic_password_mode proj_restic_password
  if ask_yn "Use global restic password for this project?" "y"; then
    proj_restic_password_mode="global"
    proj_restic_password=""
  else
    proj_restic_password_mode="custom"
    if ask_yn "Auto-generate a project-specific restic password?" "y"; then
      proj_restic_password=$(generate_password)
      print_success "Restic password generated (stored as ${proj_env_key}_RESTIC_PASSWORD in .env)"
    else
      while true; do
        proj_restic_password=$(ask_password "Project restic password")
        if validate_not_empty "$proj_restic_password" "Restic password"; then break; fi
      done
    fi
  fi

  local proj_snapshot_mode
  while true; do
    proj_snapshot_mode=$(ask "Snapshot mode (combined/separate)" "combined")
    case "$proj_snapshot_mode" in
      combined|separate) break ;;
      *) print_error "Must be 'combined' or 'separate'" ;;
    esac
  done

  # Retention
  echo ""
  echo -e "  ${BOLD}Retention:${RESET}"
  print_dim "Local = days to keep dump files on disk before cleanup deletes them"
  print_dim "Remote = how many restic snapshots to keep (daily/weekly/monthly)"
  print_dim "Example: 7 daily + 4 weekly + 6 monthly ≈ 3 months of recovery points"
  echo ""
  local proj_ret_local proj_ret_daily proj_ret_weekly proj_ret_monthly
  proj_ret_local=$(ask "Local retention days" "7")
  proj_ret_daily=$(ask "Remote keep daily" "7")
  proj_ret_weekly=$(ask "Remote keep weekly" "4")
  proj_ret_monthly=$(ask "Remote keep monthly" "6")

  # Encryption override (only for database dumps)
  local proj_encryption_enabled="false"
  local proj_encryption_type="$ENCRYPTION_TYPE"
  local proj_gpg_recipient="$GPG_RECIPIENT"

  if [ "$proj_has_db" = "true" ]; then
    proj_encryption_enabled="$ENCRYPTION_ENABLED"
    echo ""
    if [ "$ENCRYPTION_ENABLED" = "true" ]; then
      if ! ask_yn "Use global encryption settings (GPG → ${GPG_RECIPIENT})?" "y"; then
        if ask_yn "Enable encryption for this project?" "n"; then
          proj_encryption_enabled="true"
          proj_encryption_type="gpg"
          while true; do
            proj_gpg_recipient=$(ask "GPG recipient for this project" "")
            if validate_not_empty "$proj_gpg_recipient" "GPG recipient"; then break; fi
          done
        else
          proj_encryption_enabled="false"
        fi
      fi
    else
      if ask_yn "Enable encryption for this project? (global default: no)" "n"; then
        proj_encryption_enabled="true"
        proj_encryption_type="gpg"
        while true; do
          proj_gpg_recipient=$(ask "GPG recipient" "")
          if validate_not_empty "$proj_gpg_recipient" "GPG recipient"; then break; fi
        done
      fi
    fi
  fi

  # Verification (only meaningful for database backups)
  local proj_verification="false"
  if [ "$proj_has_db" = "true" ]; then
    echo ""
    proj_verification="true"
    if ! ask_yn "Enable backup verification?" "y"; then
      proj_verification="false"
    fi
  fi

  # Hooks
  echo ""
  echo -e "  ${BOLD}Hooks:${RESET} ${DIM}(optional shell commands run before/after backup)${RESET}"
  local proj_pre_hook proj_post_hook
  proj_pre_hook=$(ask "Pre-backup hook command (empty = none)" "")
  proj_post_hook=$(ask "Post-backup hook command (empty = none)" "")

  # Notification override
  echo ""
  local proj_notif_type="$NOTIFICATION_TYPE"
  local proj_notif_config=""

  if [ "$NOTIFICATION_TYPE" != "none" ]; then
    if ! ask_yn "Use global notification settings (${NOTIFICATION_TYPE})?" "y"; then
      while true; do
        proj_notif_type=$(ask "Notification type for this project (slack/email/webhook/none)" "$NOTIFICATION_TYPE")
        case "$proj_notif_type" in
          slack|email|webhook|none) break ;;
          *) print_error "Must be one of: slack, email, webhook, none" ;;
        esac
      done

      case "$proj_notif_type" in
        slack)
          local p_slack_url
          while true; do
            p_slack_url=$(ask "Slack webhook URL" "")
            if validate_not_empty "$p_slack_url" "Slack webhook URL"; then break; fi
          done
          proj_notif_config="slack:${p_slack_url}"
          ;;
        email)
          local p_email_host p_email_port p_email_secure p_email_user p_email_pass p_email_from p_email_to
          p_email_host=$(ask_required "SMTP host" "smtp.gmail.com" "SMTP host")
          p_email_port=$(ask_port "SMTP port" "587")
          if ask_yn "Use TLS/SSL?" "y"; then p_email_secure="true"; else p_email_secure="false"; fi
          p_email_user=$(ask_required "SMTP username" "" "SMTP user")
          p_email_pass=$(ask_password "SMTP password")
          p_email_from=$(ask_required "From address" "" "From address")
          p_email_to=$(ask_required "To address(es)" "" "To address")
          proj_notif_config="email:${p_email_host}:${p_email_port}:${p_email_secure}:${p_email_user}:${p_email_pass}:${p_email_from}:${p_email_to}"
          ;;
        webhook)
          local p_webhook_url
          while true; do
            p_webhook_url=$(ask "Webhook URL" "")
            if validate_not_empty "$p_webhook_url" "Webhook URL"; then break; fi
          done
          proj_notif_config="webhook:${p_webhook_url}"
          ;;
      esac
    fi
  else
    if ask_yn "Configure notifications for this project?" "n"; then
      while true; do
        proj_notif_type=$(ask "Notification type (slack/email/webhook)" "slack")
        case "$proj_notif_type" in
          slack|email|webhook) break ;;
          *) print_error "Must be one of: slack, email, webhook" ;;
        esac
      done
      case "$proj_notif_type" in
        slack)
          local p_slack_url
          while true; do
            p_slack_url=$(ask "Slack webhook URL" "")
            if validate_not_empty "$p_slack_url" "Slack webhook URL"; then break; fi
          done
          proj_notif_config="slack:${p_slack_url}"
          ;;
        webhook)
          local p_webhook_url
          while true; do
            p_webhook_url=$(ask "Webhook URL" "")
            if validate_not_empty "$p_webhook_url" "Webhook URL"; then break; fi
          done
          proj_notif_config="webhook:${p_webhook_url}"
          ;;
      esac
    fi
  fi

  # Store the env vars for this project
  if [ "$proj_has_db" = "true" ]; then
    env_set "${proj_env_key}_DB_PASSWORD" "$proj_db_password"
  fi
  if [ "$proj_restic_password_mode" = "custom" ]; then
    env_set "${proj_env_key}_RESTIC_PASSWORD" "$proj_restic_password"
  fi

  # Build YAML block for this project
  local yaml=""
  yaml+="  - name: ${proj_name}"$'\n'
  yaml+="    enabled: ${proj_enabled}"$'\n'
  yaml+="    cron: \"${proj_cron}\""$'\n'
  if [ -n "$proj_timeout" ]; then
    yaml+="    timeout_minutes: ${proj_timeout}"$'\n'
  fi
  if [ -n "$proj_docker_network" ]; then
    yaml+="    docker_network: ${proj_docker_network}"$'\n'
  fi

  if [ "$proj_has_db" = "true" ]; then
    yaml+=""$'\n'
    yaml+="    database:"$'\n'
    yaml+="      type: ${proj_db_type}"$'\n'
    yaml+="      host: ${proj_db_host}"$'\n'
    yaml+="      port: ${proj_db_port}"$'\n'
    yaml+="      name: ${proj_db_name}"$'\n'
    yaml+="      user: ${proj_db_user}"$'\n'
    yaml+="      password: \${${proj_env_key}_DB_PASSWORD}"$'\n'
    yaml+=""$'\n'
    yaml+="    compression:"$'\n'
    yaml+="      enabled: true"$'\n'
  fi

  if [ -n "$proj_assets" ]; then
    yaml+=""$'\n'
    yaml+="    assets:"$'\n'
    yaml+="      paths:"$'\n'
    IFS=',' read -ra asset_arr <<< "$proj_assets"
    for asset in "${asset_arr[@]}"; do
      asset=$(echo "$asset" | xargs)  # trim whitespace
      yaml+="        - ${asset}"$'\n'
    done
  fi

  yaml+=""$'\n'
  yaml+="    restic:"$'\n'
  yaml+="      repository_path: ${proj_restic_path}"$'\n'
  if [ "$proj_restic_password_mode" = "custom" ]; then
    yaml+="      password: \${${proj_env_key}_RESTIC_PASSWORD}"$'\n'
  else
    yaml+="      password: \${RESTIC_PASSWORD}"$'\n'
  fi
  yaml+="      snapshot_mode: ${proj_snapshot_mode}"$'\n'

  yaml+=""$'\n'
  yaml+="    retention:"$'\n'
  yaml+="      local_days: ${proj_ret_local}"$'\n'
  yaml+="      keep_daily: ${proj_ret_daily}"$'\n'
  yaml+="      keep_weekly: ${proj_ret_weekly}"$'\n'
  yaml+="      keep_monthly: ${proj_ret_monthly}"$'\n'

  if [ "$proj_encryption_enabled" = "true" ]; then
    yaml+=""$'\n'
    yaml+="    encryption:"$'\n'
    yaml+="      enabled: true"$'\n'
    yaml+="      type: ${proj_encryption_type}"$'\n'
    yaml+="      recipient: ${proj_gpg_recipient}"$'\n'
  fi

  if [ -n "$proj_pre_hook" ] || [ -n "$proj_post_hook" ]; then
    yaml+=""$'\n'
    yaml+="    hooks:"$'\n'
    if [ -n "$proj_pre_hook" ]; then
      yaml+="      pre_backup: \"${proj_pre_hook}\""$'\n'
    fi
    if [ -n "$proj_post_hook" ]; then
      yaml+="      post_backup: \"${proj_post_hook}\""$'\n'
    fi
  fi

  if [ "$proj_has_db" = "true" ]; then
    yaml+=""$'\n'
    yaml+="    verification:"$'\n'
    yaml+="      enabled: ${proj_verification}"$'\n'
  fi

  # Notification block
  if [ "$proj_notif_type" != "none" ] && [ "$proj_notif_type" != "$NOTIFICATION_TYPE" -o -n "$proj_notif_config" ]; then
    yaml+=""$'\n'
    yaml+="    notification:"$'\n'
    yaml+="      type: ${proj_notif_type}"$'\n'
    if [ -n "$proj_notif_config" ]; then
      yaml+="      config:"$'\n'
      case "$proj_notif_type" in
        slack)
          local url="${proj_notif_config#slack:}"
          yaml+="        webhook_url: ${url}"$'\n'
          ;;
        webhook)
          local url="${proj_notif_config#webhook:}"
          yaml+="        webhook_url: ${url}"$'\n'
          ;;
        email)
          IFS=':' read -r _ eh ep es eu epass ef et <<< "$proj_notif_config"
          yaml+="        smtp_host: ${eh}"$'\n'
          yaml+="        smtp_port: ${ep}"$'\n'
          yaml+="        smtp_secure: ${es}"$'\n'
          yaml+="        smtp_user: ${eu}"$'\n'
          yaml+="        smtp_password: ${epass}"$'\n'
          yaml+="        from: ${ef}"$'\n'
          yaml+="        to: ${et}"$'\n'
          ;;
      esac
    fi
  fi

  PROJECTS+=("$yaml")

  echo ""
  print_success "Project '${proj_name}' added"
}

# ════════════════════════════════════════════════════════════
# Step 9: Review Configuration
# ════════════════════════════════════════════════════════════

step_review() {
  while true; do
    print_step 9 "Review Configuration"

    echo -e "  ${BOLD}Application${RESET}"
    echo -e "    Port: ${CYAN}${APP_PORT}${RESET}  |  Timezone: ${CYAN}${TIMEZONE}${RESET}  |  Backup dir: ${CYAN}${BACKUP_BASE_DIR}${RESET}"
    echo -e "    Log level: ${CYAN}${LOG_LEVEL}${RESET}  |  Min free disk: ${CYAN}${HEALTH_DISK_MIN_FREE_GB} GB${RESET}"
    echo ""

    echo -e "  ${BOLD}Audit Database${RESET}"
    echo -e "    ${CYAN}${AUDIT_DB_USER}@${AUDIT_DB_HOST}:${AUDIT_DB_PORT}/${AUDIT_DB_NAME}${RESET}"
    echo ""

    echo -e "  ${BOLD}Hetzner Storage Box${RESET}"
    echo -e "    ${CYAN}${HETZNER_SSH_USER}@${HETZNER_SSH_HOST}:${HETZNER_SSH_PORT}${RESET}"
    echo ""

    echo -e "  ${BOLD}Restic${RESET}"
    echo -e "    Password: ${DIM}(generated)${RESET}  |  Retries: ${CYAN}${BACKUP_RETRY_COUNT}${RESET}  |  Delay: ${CYAN}${BACKUP_RETRY_DELAY_MS}ms${RESET}"
    echo ""

    echo -e "  ${BOLD}Notifications${RESET}"
    echo -e "    Type: ${CYAN}${NOTIFICATION_TYPE}${RESET}  |  Summary cron: ${CYAN}${DAILY_SUMMARY_CRON}${RESET}"
    echo ""

    echo -e "  ${BOLD}Encryption${RESET}"
    if [ "$ENCRYPTION_ENABLED" = "true" ]; then
      echo -e "    Enabled: ${CYAN}yes${RESET}  |  Type: ${CYAN}${ENCRYPTION_TYPE}${RESET}  |  Recipient: ${CYAN}${GPG_RECIPIENT}${RESET}"
    else
      echo -e "    Enabled: ${CYAN}no${RESET}"
    fi
    echo ""

    echo -e "  ${BOLD}Projects (${PROJECT_COUNT})${RESET}"
    if [ ${#PROJECTS[@]} -eq 0 ]; then
      echo -e "    ${DIM}(none configured)${RESET}"
    else
      for proj_yaml in "${PROJECTS[@]}"; do
        local pname pcron pnet pdb_type pdb_host pdb_name
        pname=$(echo "$proj_yaml" | grep 'name:' | head -1 | sed 's/.*name: //')
        pcron=$(echo "$proj_yaml" | grep 'cron:' | head -1 | sed 's/.*cron: "//;s/"//')
        pnet=$(echo "$proj_yaml" | grep 'docker_network:' | head -1 | sed 's/.*docker_network: //')
        local net_info=""
        if [ -n "$pnet" ]; then
          net_info=" — net: ${DIM}${pnet}${RESET}"
        fi
        local scope_info=""
        if echo "$proj_yaml" | grep -q '    database:'; then
          pdb_type=$(echo "$proj_yaml" | grep '      type:' | head -1 | sed 's/.*type: //')
          pdb_host=$(echo "$proj_yaml" | grep '      host:' | head -1 | sed 's/.*host: //')
          pdb_name=$(echo "$proj_yaml" | grep '      name:' | head -1 | sed 's/.*name: //')
          scope_info="${pdb_type} @ ${pdb_host}/${pdb_name}"
        fi
        if echo "$proj_yaml" | grep -q '    assets:'; then
          if [ -n "$scope_info" ]; then
            scope_info="${scope_info} + files"
          else
            scope_info="files only"
          fi
        fi
        echo -e "    ${CHECKMARK} ${BOLD}${pname}${RESET} — ${scope_info} — cron: ${DIM}${pcron}${RESET}${net_info}"
      done
    fi
    echo ""

    echo -e "  ${BOLD}━━━ Re-run a step? ━━━${RESET}"
    echo -e "    ${DIM}2)${RESET} Application    ${DIM}3)${RESET} Audit DB      ${DIM}4)${RESET} Hetzner"
    echo -e "    ${DIM}5)${RESET} Restic         ${DIM}6)${RESET} Notifications ${DIM}7)${RESET} Encryption"
    echo -e "    ${DIM}8)${RESET} Projects       ${DIM}c)${RESET} Continue to generate files"
    echo ""

    local choice
    choice=$(ask "Re-run step or continue" "c")

    case "$choice" in
      2) step_app_settings ;;
      3) step_audit_db ;;
      4) step_hetzner ;;
      5) step_restic ;;
      6) step_notifications ;;
      7) step_encryption ;;
      8) step_projects ;;
      c|C) break ;;
      *) print_error "Invalid choice. Enter a step number (2-8) or 'c' to continue." ;;
    esac
  done

  print_success "Configuration reviewed"
}

# ════════════════════════════════════════════════════════════
# Step 10: Generate Configuration Files
# ════════════════════════════════════════════════════════════

step_generate() {
  print_step 10 "Generate Configuration Files"

  # Create directories (gpg-keys/ always needed — Docker compose mounts it)
  mkdir -p config ssh-keys gpg-keys
  print_success "Directories created: config/, ssh-keys/, gpg-keys/"

  # ── Generate .env ──
  cat > .env <<ENVEOF
# ════════════════════════════════════════════════════════════
# backupctl Environment Configuration
# Generated by install.sh on $(date '+%Y-%m-%d %H:%M:%S')
# ════════════════════════════════════════════════════════════

# ── Application ──────────────────────────────────────────
APP_PORT=${APP_PORT}
TIMEZONE=${TIMEZONE}
BACKUP_BASE_DIR=${BACKUP_BASE_DIR}
LOG_LEVEL=${LOG_LEVEL}
LOG_DIR=${BACKUP_BASE_DIR}/.logs
LOG_MAX_SIZE=10m
LOG_MAX_FILES=5
HEALTH_DISK_MIN_FREE_GB=${HEALTH_DISK_MIN_FREE_GB}

# ── Audit Database ───────────────────────────────────────
AUDIT_DB_HOST=${AUDIT_DB_HOST}
AUDIT_DB_PORT=${AUDIT_DB_PORT}
AUDIT_DB_NAME=${AUDIT_DB_NAME}
AUDIT_DB_USER=${AUDIT_DB_USER}
AUDIT_DB_PASSWORD=${AUDIT_DB_PASSWORD}

# ── Hetzner Storage Box ─────────────────────────────────
HETZNER_SSH_HOST=${HETZNER_SSH_HOST}
HETZNER_SSH_USER=${HETZNER_SSH_USER}
HETZNER_SSH_PORT=${HETZNER_SSH_PORT}
HETZNER_SSH_KEY_PATH=/home/node/.ssh/id_${SSH_KEY_TYPE:-ed25519}

# ── Restic ───────────────────────────────────────────────
RESTIC_PASSWORD=${RESTIC_PASSWORD}
BACKUP_RETRY_COUNT=${BACKUP_RETRY_COUNT}
BACKUP_RETRY_DELAY_MS=${BACKUP_RETRY_DELAY_MS}

# ── Notifications ────────────────────────────────────────
NOTIFICATION_TYPE=${NOTIFICATION_TYPE}
DAILY_SUMMARY_CRON=${DAILY_SUMMARY_CRON}
ENVEOF

  if [ "$NOTIFICATION_TYPE" = "slack" ] && [ -n "$SLACK_WEBHOOK_URL" ]; then
    cat >> .env <<ENVEOF
SLACK_WEBHOOK_URL=${SLACK_WEBHOOK_URL}
ENVEOF
  fi

  if [ "$NOTIFICATION_TYPE" = "email" ]; then
    cat >> .env <<ENVEOF
SMTP_HOST=${SMTP_HOST}
SMTP_PORT=${SMTP_PORT}
SMTP_SECURE=${SMTP_SECURE}
SMTP_USER=${SMTP_USER}
SMTP_PASSWORD=${SMTP_PASSWORD}
SMTP_FROM=${SMTP_FROM}
SMTP_TO=${SMTP_TO}
ENVEOF
  fi

  if [ "$NOTIFICATION_TYPE" = "webhook" ] && [ -n "$WEBHOOK_URL" ]; then
    cat >> .env <<ENVEOF
WEBHOOK_URL=${WEBHOOK_URL}
ENVEOF
  fi

  cat >> .env <<ENVEOF

# ── Encryption ───────────────────────────────────────────
ENCRYPTION_ENABLED=${ENCRYPTION_ENABLED}
GPG_KEYS_DIR=./gpg-keys
ENVEOF

  if [ "$ENCRYPTION_ENABLED" = "true" ]; then
    cat >> .env <<ENVEOF
ENCRYPTION_TYPE=${ENCRYPTION_TYPE}
GPG_RECIPIENT=${GPG_RECIPIENT}
ENVEOF
  fi

  # Append project-specific secrets
  if [ -n "$ENV_VARS" ]; then
    cat >> .env <<ENVEOF

# ── Project Secrets ──────────────────────────────────────
ENVEOF
    echo -n "$ENV_VARS" >> .env
  fi

  chmod 600 .env
  print_success ".env generated (permissions: 600)"

  # ── Generate config/projects.yml ──
  cat > config/projects.yml <<YMLEOF
# ════════════════════════════════════════════════════════════
# backupctl Project Configuration
# Generated by install.sh on $(date '+%Y-%m-%d %H:%M:%S')
# ════════════════════════════════════════════════════════════

projects:
YMLEOF

  if [ ${#PROJECTS[@]} -eq 0 ]; then
    echo "  []" >> config/projects.yml
  else
    for proj_yaml in "${PROJECTS[@]}"; do
      echo "$proj_yaml" >> config/projects.yml
    done
  fi

  print_success "config/projects.yml generated"

  # ── Summary ──
  echo ""
  echo -e "  ${BOLD}Generated files:${RESET}"
  echo -e "    ${CHECKMARK} .env"
  echo -e "    ${CHECKMARK} config/projects.yml"
  [ -d ssh-keys ] && echo -e "    ${CHECKMARK} ssh-keys/"
  [ -d gpg-keys ] && echo -e "    ${CHECKMARK} gpg-keys/"
}

# ════════════════════════════════════════════════════════════
# Step 11: Docker Setup
# ════════════════════════════════════════════════════════════

step_docker() {
  print_step 11 "Docker Setup"

  if ! ask_yn "Build and start Docker containers now?" "y"; then
    print_info "Skipping Docker setup. Run later with: docker compose up -d --build"
    return
  fi

  # Build and start
  echo ""
  print_info "Building and starting containers (this may take a few minutes)..."
  echo ""
  local build_log
  build_log=$(mktemp)
  if docker compose up -d --build >"$build_log" 2>&1; then
    print_success "Containers started"

    # Auto-connect project Docker networks
    for proj_yaml in "${PROJECTS[@]}"; do
      local pnet
      pnet=$(echo "$proj_yaml" | grep 'docker_network:' | head -1 | sed 's/.*docker_network: //')
      if [ -n "$pnet" ]; then
        if docker network ls --format '{{.Name}}' | grep -q "^${pnet}$"; then
          docker network connect "$pnet" backupctl 2>/dev/null \
            && print_success "Connected to network: ${pnet}" \
            || print_warning "Failed to connect to network: ${pnet}"
        else
          print_warning "Docker network '${pnet}' not found — connect manually after it's created"
        fi
      fi
    done
  else
    echo ""
    print_error "Docker Compose failed:"
    echo -e "  ${DIM}$(tail -10 "$build_log")${RESET}"
    echo ""
    print_info "Fix the issue and re-run: docker compose up -d --build"
    rm -f "$build_log"
    return
  fi
  rm -f "$build_log"

  # Wait for health
  echo ""
  print_info "Waiting for containers to become healthy..."
  local retries=0
  local max_retries=15
  while [ $retries -lt $max_retries ]; do
    sleep 2
    if docker exec backupctl-audit-db pg_isready -U "$AUDIT_DB_USER" &>/dev/null; then
      print_success "Audit database is ready"
      break
    fi
    retries=$((retries + 1))
    echo -ne "\r  Waiting... (${retries}/${max_retries})"
  done
  echo ""

  if [ $retries -ge $max_retries ]; then
    print_warning "Audit database did not become ready in time. Check logs with: docker compose logs"
  fi

  # Create remote directories + initialize restic repos
  if [ ${#PROJECTS[@]} -gt 0 ] && ask_yn "Initialize restic repositories for configured projects?" "y"; then
    echo ""

    # Pre-create remote directories on the storage box via SFTP
    local key_file="ssh-keys/id_${SSH_KEY_TYPE:-ed25519}"
    if [ -f "$key_file" ]; then
      print_info "Creating remote directories on storage box..."
      for proj_yaml in "${PROJECTS[@]}"; do
        local repo_path
        repo_path=$(echo "$proj_yaml" | grep 'repository_path:' | head -1 | sed 's/.*repository_path: //')
        if [ -n "$repo_path" ]; then
          echo -ne "  Creating remote directory: ${repo_path}..."
          if echo "mkdir ${repo_path}" | sftp -b - \
            -i "$key_file" \
            -P "${HETZNER_SSH_PORT:-23}" \
            -o StrictHostKeyChecking=accept-new \
            "${HETZNER_SSH_USER}@${HETZNER_SSH_HOST}" &>/dev/null; then
            echo -e " ${CHECKMARK}"
          else
            echo -e " ${WARNING} ${DIM}(may already exist or parent dir missing)${RESET}"
            # Try creating parent + child
            local parent_dir
            parent_dir=$(dirname "$repo_path")
            if [ "$parent_dir" != "." ]; then
              printf "mkdir %s\nmkdir %s\n" "$parent_dir" "$repo_path" | sftp -b - \
                -i "$key_file" \
                -P "${HETZNER_SSH_PORT:-23}" \
                -o StrictHostKeyChecking=accept-new \
                "${HETZNER_SSH_USER}@${HETZNER_SSH_HOST}" &>/dev/null || true
              print_dim "Attempted to create parent directory: ${parent_dir}"
            fi
          fi
        fi
      done
      echo ""
    else
      print_warning "SSH key not found at ${key_file}. Skipping remote directory creation."
      print_dim "Create directories manually: sftp -P ${HETZNER_SSH_PORT:-23} ${HETZNER_SSH_USER:-user}@${HETZNER_SSH_HOST:-host}"
    fi

    # Initialize restic repos inside the container
    for proj_yaml in "${PROJECTS[@]}"; do
      local pname
      pname=$(echo "$proj_yaml" | head -1 | sed 's/.*name: //')
      echo -ne "  Initializing restic repo for ${pname}..."
      if docker exec backupctl node dist/cli.js restic "$pname" init 2>/dev/null; then
        echo -e " ${CHECKMARK}"
      else
        echo -e " ${WARNING} ${DIM}(may already exist or container not ready)${RESET}"
      fi
    done
  fi

  # Run health check
  echo ""
  echo -ne "  Running health check..."
  if docker exec backupctl node dist/cli.js health 2>/dev/null; then
    echo -e " ${CHECKMARK}"
    print_success "Health check passed"
  else
    echo -e ""
    print_warning "Health check did not pass. This is normal before first deploy."
    print_dim "Run 'docker exec backupctl node dist/cli.js health' after deployment."
  fi
}

# ════════════════════════════════════════════════════════════
# Step 12: CLI Shortcuts
# ════════════════════════════════════════════════════════════

step_cli_shortcuts() {
  print_step 12 "CLI Shortcuts"

  print_dim "Install 'backupctl' and 'backupctl-dev' commands so you can run"
  print_dim "CLI commands from any directory without the Docker exec prefix."
  echo ""
  echo -e "  ${DIM}Instead of:  docker exec backupctl node dist/cli.js health${RESET}"
  echo -e "  ${DIM}Just type:   backupctl health${RESET}"
  echo ""

  if ! ask_yn "Install CLI shortcuts?" "y"; then
    print_info "Skipped. Install later with: ./scripts/install-cli.sh"
    return
  fi

  echo ""
  echo -e "  Install location:"
  echo ""
  echo -e "    ${BOLD}1)${RESET} ${HOME}/.local/bin  ${DIM}(user only, no sudo)${RESET}"
  echo -e "    ${BOLD}2)${RESET} /usr/local/bin  ${DIM}(system-wide, requires sudo)${RESET}"
  echo ""

  local choice
  choice=$(ask "Choose" "1")

  echo ""

  case "$choice" in
    2)
      "${SCRIPT_DIR}/install-cli.sh" --system
      ;;
    *)
      "${SCRIPT_DIR}/install-cli.sh" --user
      ;;
  esac
}

# ════════════════════════════════════════════════════════════
# Step 13: Completion
# ════════════════════════════════════════════════════════════

step_completion() {
  print_step 13 "Installation Complete"

  echo -e "${BOLD}${GREEN}"
  echo "  ╔═══════════════════════════════════════════════════════════╗"
  echo "  ║               Installation Successful!                    ║"
  echo "  ╚═══════════════════════════════════════════════════════════╝"
  echo -e "${RESET}"

  # Project summary
  if [ "$PROJECT_COUNT" -gt 0 ]; then
    echo -e "  ${BOLD}Configured Projects:${RESET}"
    for proj_yaml in "${PROJECTS[@]}"; do
      local pname pcron
      pname=$(echo "$proj_yaml" | head -1 | sed 's/.*name: //')
      pcron=$(echo "$proj_yaml" | grep 'cron:' | head -1 | sed 's/.*cron: "//;s/"//')
      echo -e "    ${CHECKMARK} ${BOLD}${pname}${RESET} — schedule: ${DIM}${pcron}${RESET}"
    done
    echo ""
  fi

  # File summary
  echo -e "  ${BOLD}Generated Files:${RESET}"
  echo -e "    .env                  ${DIM}— secrets & global configuration${RESET}"
  echo -e "    config/projects.yml   ${DIM}— project backup definitions${RESET}"
  [ -d ssh-keys ] && echo -e "    ssh-keys/             ${DIM}— SSH keys for storage box${RESET}"
  [ -d gpg-keys ] && echo -e "    gpg-keys/             ${DIM}— GPG keys for encryption${RESET}"
  echo ""

  # Next steps
  echo -e "  ${BOLD}Next Steps:${RESET}"
  echo ""
  if [ -f "ssh-keys/id_${SSH_KEY_TYPE:-ed25519}.pub" ]; then
    echo -e "  ${BOLD}1.${RESET} Install SSH public key on Hetzner Storage Box:"
    echo -e "     ${DIM}ssh-copy-id -p ${HETZNER_SSH_PORT:-23} -i ssh-keys/id_${SSH_KEY_TYPE:-ed25519}.pub ${HETZNER_SSH_USER:-user}@${HETZNER_SSH_HOST:-host}${RESET}"
    echo ""
  fi
  # Detect whether CLI shortcuts are installed
  local use_shortcut=false
  if command -v backupctl &>/dev/null; then
    use_shortcut=true
  fi

  echo -e "  ${BOLD}2.${RESET} Verify the installation:"
  if [ "$use_shortcut" = true ]; then
    echo -e "     ${CYAN}backupctl health${RESET}"
  else
    echo -e "     ${CYAN}docker exec backupctl node dist/cli.js health${RESET}"
  fi
  echo ""
  echo -e "  ${BOLD}3.${RESET} Test a backup (dry run):"
  if [ "$PROJECT_COUNT" -gt 0 ]; then
    local first_name
    first_name=$(echo "${PROJECTS[0]}" | head -1 | sed 's/.*name: //')
    if [ "$use_shortcut" = true ]; then
      echo -e "     ${CYAN}backupctl run ${first_name} --dry-run${RESET}"
    else
      echo -e "     ${CYAN}docker exec backupctl node dist/cli.js run ${first_name} --dry-run${RESET}"
    fi
  else
    if [ "$use_shortcut" = true ]; then
      echo -e "     ${CYAN}backupctl run <project> --dry-run${RESET}"
    else
      echo -e "     ${CYAN}docker exec backupctl node dist/cli.js run <project> --dry-run${RESET}"
    fi
  fi
  echo ""
  echo -e "  ${BOLD}4.${RESET} Check backup status:"
  if [ "$use_shortcut" = true ]; then
    echo -e "     ${CYAN}backupctl status${RESET}"
  else
    echo -e "     ${CYAN}docker exec backupctl node dist/cli.js status${RESET}"
  fi
  echo ""

  # Useful commands
  echo -e "  ${BOLD}Useful Commands:${RESET}"
  if [ "$use_shortcut" = true ]; then
    echo -e "    ${CYAN}backupctl health${RESET}                    — Health check"
    echo -e "    ${CYAN}backupctl run <project>${RESET}             — Run backup"
    echo -e "    ${CYAN}backupctl status${RESET}                    — Backup status"
    echo -e "    ${CYAN}backupctl-dev health${RESET}                — Dev health check"
    echo -e "    ${CYAN}backupctl-dev run <project> --dry-run${RESET} — Dev dry run"
  else
    echo -e "    ${DIM}docker exec backupctl node dist/cli.js health${RESET}"
    echo -e "    ${DIM}docker exec backupctl node dist/cli.js run <project>${RESET}"
    echo -e "    ${DIM}docker exec backupctl node dist/cli.js status${RESET}"
  fi
  echo ""
  echo -e "  ${BOLD}Management:${RESET}"
  echo -e "    ${DIM}scripts/backupctl-manage.sh status${RESET}    — Quick status overview"
  echo -e "    ${DIM}scripts/backupctl-manage.sh logs${RESET}      — Tail container logs"
  echo -e "    ${DIM}scripts/backupctl-manage.sh shell${RESET}     — Shell into container"
  echo -e "    ${DIM}scripts/backupctl-manage.sh deploy${RESET}    — Rebuild and deploy"
  echo ""
  echo -e "  ${BOLD}Troubleshooting:${RESET}"
  echo -e "    ${DIM}docs/15-faq.md${RESET}                — FAQ (setup, operations, and more)"
  echo -e "    ${DIM}docs/12-troubleshooting.md${RESET}       — General troubleshooting"
  echo ""
}

# ════════════════════════════════════════════════════════════
# Main
# ════════════════════════════════════════════════════════════

main() {
  welcome
  step_prerequisites
  step_app_settings
  step_audit_db
  step_hetzner
  step_restic
  step_notifications
  step_encryption
  step_projects
  step_review
  step_generate
  step_docker
  step_cli_shortcuts
  step_completion
}

main
