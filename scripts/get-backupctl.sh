#!/bin/bash
set -e

# ════════════════════════════════════════════════════════════
# backupctl Remote Installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/vineethkrishnan/backupctl/main/scripts/get-backupctl.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/vineethkrishnan/backupctl/main/scripts/get-backupctl.sh | bash -s -- --dir /opt/backupctl
# ════════════════════════════════════════════════════════════

REPO="vineethkrishnan/backupctl"
BRANCH="main"
BASE_URL="https://raw.githubusercontent.com/${REPO}/${BRANCH}"
IMAGE="vineethnkrishnan/backupctl"
INSTALL_DIR="${HOME}/backupctl"

# ── Colors ─────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

ok()   { echo -e "  ${GREEN}✔${RESET} $1"; }
err()  { echo -e "  ${RED}✘${RESET} $1"; }
info() { echo -e "  ${CYAN}→${RESET} $1"; }
warn() { echo -e "  ${YELLOW}⚠${RESET} $1"; }

# ── Parse arguments ────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) INSTALL_DIR="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Banner ─────────────────────────────────────────────────

echo ""
echo -e "${BOLD}${CYAN}╔═══════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${CYAN}║${RESET}${BOLD}       backupctl — Remote Installer                  ${BOLD}${CYAN}║${RESET}"
echo -e "${BOLD}${CYAN}║${RESET}${DIM}       Backup orchestration for databases & files     ${BOLD}${CYAN}║${RESET}"
echo -e "${BOLD}${CYAN}╚═══════════════════════════════════════════════════════╝${RESET}"
echo ""

# ── Prerequisites ──────────────────────────────────────────

echo -e "${BOLD}Checking prerequisites...${RESET}"
echo ""

MISSING=0

if command -v docker &>/dev/null; then
  ok "Docker $(docker --version | grep -oP '\d+\.\d+\.\d+')"
else
  err "Docker not found — install from https://docs.docker.com/get-docker/"
  MISSING=1
fi

if docker compose version &>/dev/null; then
  ok "Docker Compose $(docker compose version --short)"
else
  err "Docker Compose not found — install Docker Compose V2"
  MISSING=1
fi

if command -v curl &>/dev/null; then
  ok "curl available"
else
  err "curl not found"
  MISSING=1
fi

if [ "$MISSING" -eq 1 ]; then
  echo ""
  err "Missing prerequisites. Install them and re-run."
  exit 1
fi

echo ""

# ── Create install directory ───────────────────────────────

echo -e "${BOLD}Installing to: ${INSTALL_DIR}${RESET}"
echo ""

if [ -d "$INSTALL_DIR" ]; then
  if [ -f "$INSTALL_DIR/docker-compose.yml" ]; then
    warn "Existing installation detected at ${INSTALL_DIR}"
    echo ""
    read -rp "  Overwrite? (y/N) " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
      info "Cancelled."
      exit 0
    fi
  fi
else
  mkdir -p "$INSTALL_DIR"
  ok "Created ${INSTALL_DIR}"
fi

mkdir -p "$INSTALL_DIR"/{config,ssh-keys,gpg-keys,scripts}

# ── Determine image tag ───────────────────────────────────

if [ -z "$VERSION" ]; then
  info "Fetching latest release..."
  VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null | grep '"tag_name"' | head -1 | sed 's/.*"v\([^"]*\)".*/\1/' || echo "")

  if [ -z "$VERSION" ]; then
    warn "No release found — using 'latest' tag"
    IMAGE_TAG="latest"
  else
    IMAGE_TAG="$VERSION"
    ok "Latest release: v${VERSION}"
  fi
else
  IMAGE_TAG="$VERSION"
  ok "Using version: v${VERSION}"
fi

# ── Generate docker-compose.yml ────────────────────────────

info "Generating docker-compose.yml..."

cat > "$INSTALL_DIR/docker-compose.yml" <<YAML
services:
  backupctl:
    container_name: backupctl
    image: ${IMAGE}:${IMAGE_TAG}
    env_file: .env
    environment:
      AUDIT_DB_HOST: backupctl-audit-db
    ports:
      - '\${APP_PORT:-3100}:\${APP_PORT:-3100}'
    volumes:
      - \${BACKUP_BASE_DIR:-/data/backups}:/data/backups
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
      POSTGRES_DB: \${AUDIT_DB_NAME:-backup_audit}
      POSTGRES_USER: \${AUDIT_DB_USER:-audit_user}
      POSTGRES_PASSWORD: \${AUDIT_DB_PASSWORD}
    volumes:
      - backupctl-audit-data:/var/lib/postgresql/data
    networks:
      - backupctl-network
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U \${AUDIT_DB_USER:-audit_user} -d \${AUDIT_DB_NAME:-backup_audit}']
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
YAML

ok "docker-compose.yml created"

# ── Download scripts ───────────────────────────────────────

info "Downloading management scripts..."

for file in install.sh install-cli.sh backupctl-manage.sh; do
  if curl -fsSL "${BASE_URL}/scripts/${file}" -o "$INSTALL_DIR/scripts/${file}" 2>/dev/null; then
    chmod +x "$INSTALL_DIR/scripts/${file}"
    ok "scripts/${file}"
  else
    warn "Failed to download ${file} — skipping"
  fi
done

# ── Download .env.example ──────────────────────────────────

if [ ! -f "$INSTALL_DIR/.env" ]; then
  curl -fsSL "${BASE_URL}/.env.example" -o "$INSTALL_DIR/.env.example" 2>/dev/null && \
    ok ".env.example downloaded" || \
    warn "Failed to download .env.example"
fi

# ── Pull Docker image ─────────────────────────────────────

echo ""
info "Pulling Docker image: ${IMAGE}:${IMAGE_TAG}"
echo ""

if docker pull "${IMAGE}:${IMAGE_TAG}"; then
  ok "Image pulled successfully"
else
  warn "Image pull failed — it may not be published yet."
  warn "Run 'docker compose up --build -d' to build locally instead."
fi

# ── Summary ────────────────────────────────────────────────

echo ""
echo -e "${BOLD}${CYAN}╔═══════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${CYAN}║${RESET}${BOLD}       Installation complete!                          ${BOLD}${CYAN}║${RESET}"
echo -e "${BOLD}${CYAN}╚═══════════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  ${BOLD}Directory:${RESET}  ${INSTALL_DIR}"
echo -e "  ${BOLD}Image:${RESET}      ${IMAGE}:${IMAGE_TAG}"
echo ""
echo -e "  ${BOLD}Next steps:${RESET}"
echo ""
echo -e "  ${CYAN}1.${RESET} Run the setup wizard:"
echo -e "     ${DIM}cd ${INSTALL_DIR} && bash scripts/install.sh${RESET}"
echo ""
echo -e "  ${CYAN}2.${RESET} Or configure manually:"
echo -e "     ${DIM}cp .env.example .env && \$EDITOR .env${RESET}"
echo -e "     ${DIM}Create config/projects.yml (see docs)${RESET}"
echo -e "     ${DIM}Add SSH key to ssh-keys/id_ed25519${RESET}"
echo ""
echo -e "  ${CYAN}3.${RESET} Start the service:"
echo -e "     ${DIM}cd ${INSTALL_DIR} && docker compose up -d${RESET}"
echo ""
echo -e "  ${CYAN}4.${RESET} Verify:"
echo -e "     ${DIM}docker exec backupctl node dist/cli.js health${RESET}"
echo ""
echo -e "  ${BOLD}Docs:${RESET}  https://backupctl-docs.pages.dev"
echo -e "  ${BOLD}Repo:${RESET}  https://github.com/${REPO}"
echo ""
