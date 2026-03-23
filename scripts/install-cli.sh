#!/bin/bash
set -e

# ════════════════════════════════════════════════════════════
# Install backupctl CLI wrapper scripts
#
# Creates `backupctl` and `backupctl-dev` commands that delegate
# to the Docker containers. Works from any directory.
#
# Usage:
#   ./scripts/install-cli.sh              # interactive
#   ./scripts/install-cli.sh --user       # install to ~/.local/bin
#   ./scripts/install-cli.sh --system     # install to /usr/local/bin (sudo)
#   ./scripts/install-cli.sh --uninstall  # remove both commands
# ════════════════════════════════════════════════════════════

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

CHECKMARK="${GREEN}✔${RESET}"
CROSSMARK="${RED}✘${RESET}"
WARNING="${YELLOW}⚠${RESET}"

PROD_CMD="backupctl"
DEV_CMD="backupctl-dev"
PROD_CONTAINER="backupctl"
DEV_CONTAINER="backupctl-dev"

USER_BIN="${HOME}/.local/bin"
SYSTEM_BIN="/usr/local/bin"

# ── Helpers ────────────────────────────────────────────────

ok()   { echo -e "  ${CHECKMARK} $1"; }
warn() { echo -e "  ${WARNING} ${YELLOW}$1${RESET}"; }
err()  { echo -e "  ${CROSSMARK} ${RED}$1${RESET}"; }
info() { echo -e "  ${CYAN}→${RESET} $1"; }

is_in_path() {
  echo "$PATH" | tr ':' '\n' | grep -qx "$1"
}

check_existing() {
  local cmd="$1"
  local existing
  existing=$(command -v "$cmd" 2>/dev/null) || return 1
  echo "$existing"
}

# ── Generate wrapper script content ───────────────────────

generate_wrapper() {
  local container="$1"
  local cmd_name="$2"
  local cli_cmd="$3"

  cat <<'WRAPPER_EOF'
#!/bin/bash
set -e

CONTAINER="__CONTAINER__"
CMD_NAME="__CMD_NAME__"
CLI_CMD="__CLI_CMD__"

if ! command -v docker &>/dev/null; then
  echo "Error: Docker is not installed or not in PATH" >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
  echo "Error: Container '$CONTAINER' is not running." >&2
  echo "" >&2
  if [ "$CONTAINER" = "backupctl-dev" ]; then
    echo "Start it with:  scripts/dev.sh up" >&2
  else
    echo "Start it with:  docker compose up -d" >&2
  fi
  exit 1
fi

exec docker exec -i "$CONTAINER" $CLI_CMD "$@"
WRAPPER_EOF
}

write_wrapper() {
  local target_path="$1"
  local container="$2"
  local cmd_name="$3"
  local cli_cmd="$4"

  generate_wrapper "$container" "$cmd_name" "$cli_cmd" \
    | sed "s|__CONTAINER__|${container}|g" \
    | sed "s|__CMD_NAME__|${cmd_name}|g" \
    | sed "s|__CLI_CMD__|${cli_cmd}|g" \
    > "$target_path"

  chmod +x "$target_path"
}

# ── Install ────────────────────────────────────────────────

install_to() {
  local bin_dir="$1"
  local use_sudo="$2"
  local prefix=""

  if [ "$use_sudo" = "true" ]; then
    prefix="sudo "
  fi

  # Create directory if needed
  if [ ! -d "$bin_dir" ]; then
    ${prefix}mkdir -p "$bin_dir"
    ok "Created ${bin_dir}"
  fi

  # Production wrapper
  local prod_path="${bin_dir}/${PROD_CMD}"
  local tmp_prod
  tmp_prod=$(mktemp)
  write_wrapper "$tmp_prod" "$PROD_CONTAINER" "$PROD_CMD" "node dist/cli.js"
  ${prefix}mv "$tmp_prod" "$prod_path"
  ${prefix}chmod +x "$prod_path"
  ok "Installed ${BOLD}${PROD_CMD}${RESET} → ${DIM}${prod_path}${RESET}"

  # Dev wrapper
  local dev_path="${bin_dir}/${DEV_CMD}"
  local tmp_dev
  tmp_dev=$(mktemp)
  write_wrapper "$tmp_dev" "$DEV_CONTAINER" "$DEV_CMD" "npx ts-node -r tsconfig-paths/register src/cli.ts"
  ${prefix}mv "$tmp_dev" "$dev_path"
  ${prefix}chmod +x "$dev_path"
  ok "Installed ${BOLD}${DEV_CMD}${RESET} → ${DIM}${dev_path}${RESET}"

  # PATH check
  if ! is_in_path "$bin_dir"; then
    echo ""
    warn "${bin_dir} is not in your PATH."
    echo ""
    info "Add it by appending to your shell RC file:"
    echo ""
    echo -e "    ${CYAN}export PATH=\"${bin_dir}:\$PATH\"${RESET}"
    echo ""

    local rc_file=""
    case "$SHELL" in
      */zsh)  rc_file="$HOME/.zshrc" ;;
      */bash) rc_file="$HOME/.bashrc" ;;
      */fish) rc_file="$HOME/.config/fish/config.fish" ;;
    esac

    if [ -n "$rc_file" ]; then
      echo -ne "  Add to ${DIM}${rc_file}${RESET} automatically? [Y/n]: "
      read -r answer
      if [ -z "$answer" ] || [[ "$answer" =~ ^[yY] ]]; then
        if [ "$SHELL" = "*/fish" ]; then
          echo "set -gx PATH ${bin_dir} \$PATH" >> "$rc_file"
        else
          echo "" >> "$rc_file"
          echo "# backupctl CLI" >> "$rc_file"
          echo "export PATH=\"${bin_dir}:\$PATH\"" >> "$rc_file"
        fi
        ok "Added to ${rc_file}"
        warn "Run ${BOLD}source ${rc_file}${RESET}${YELLOW} or open a new terminal to apply${RESET}"
      fi
    fi
  fi
}

# ── Uninstall ──────────────────────────────────────────────

uninstall() {
  local removed=0

  for cmd in "$PROD_CMD" "$DEV_CMD"; do
    local existing
    existing=$(check_existing "$cmd") || continue

    local use_sudo=""
    if [ ! -w "$(dirname "$existing")" ]; then
      use_sudo="sudo "
    fi

    ${use_sudo}rm -f "$existing"
    ok "Removed ${BOLD}${cmd}${RESET} (${DIM}${existing}${RESET})"
    removed=$((removed + 1))
  done

  if [ "$removed" -eq 0 ]; then
    info "Neither ${PROD_CMD} nor ${DEV_CMD} found in PATH."
  fi
}

# ── Main ───────────────────────────────────────────────────

main() {
  echo ""
  echo -e "${BOLD}backupctl CLI Installer${RESET}"
  echo -e "${DIM}Creates 'backupctl' and 'backupctl-dev' commands${RESET}"
  echo ""

  # Handle flags
  case "${1:-}" in
    --uninstall)
      uninstall
      return
      ;;
    --user)
      install_to "$USER_BIN" "false"
      ;;
    --system)
      install_to "$SYSTEM_BIN" "true"
      ;;
    *)
      # Check for existing installations
      local existing_prod existing_dev
      existing_prod=$(check_existing "$PROD_CMD") || true
      existing_dev=$(check_existing "$DEV_CMD") || true

      if [ -n "$existing_prod" ] || [ -n "$existing_dev" ]; then
        warn "Existing installation detected:"
        [ -n "$existing_prod" ] && echo -e "    ${DIM}${PROD_CMD} → ${existing_prod}${RESET}"
        [ -n "$existing_dev" ] && echo -e "    ${DIM}${DEV_CMD} → ${existing_dev}${RESET}"
        echo ""
        echo -ne "  Overwrite? [Y/n]: "
        read -r answer
        if [[ "$answer" =~ ^[nN] ]]; then
          info "Cancelled."
          return
        fi
      fi

      # Interactive selection
      echo -e "  Install location:"
      echo ""
      echo -e "    ${BOLD}1)${RESET} ${USER_BIN}  ${DIM}(user only, no sudo)${RESET}"
      echo -e "    ${BOLD}2)${RESET} ${SYSTEM_BIN}  ${DIM}(system-wide, requires sudo)${RESET}"
      echo ""
      echo -ne "  Choose [1]: "
      read -r choice

      case "${choice:-1}" in
        2)
          install_to "$SYSTEM_BIN" "true"
          ;;
        *)
          install_to "$USER_BIN" "false"
          ;;
      esac
      ;;
  esac

  echo ""
  echo -e "  ${BOLD}Usage:${RESET}"
  echo -e "    ${CYAN}${PROD_CMD} health${RESET}                    ${DIM}# production${RESET}"
  echo -e "    ${CYAN}${PROD_CMD} run vinsware --dry-run${RESET}     ${DIM}# production${RESET}"
  echo -e "    ${CYAN}${DEV_CMD} health${RESET}                ${DIM}# development${RESET}"
  echo -e "    ${CYAN}${DEV_CMD} config show vinsware${RESET}   ${DIM}# development${RESET}"
  echo ""
}

main "$@"
