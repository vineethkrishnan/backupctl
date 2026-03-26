#!/bin/sh
set -e

BACKUP_BASE_DIR="${BACKUP_BASE_DIR:-/data/backups}"

# Ensure backup directories exist and are writable
mkdir -p "$BACKUP_BASE_DIR/.logs" "$BACKUP_BASE_DIR/.fallback-audit" 2>/dev/null || true

if [ ! -w "$BACKUP_BASE_DIR" ]; then
  echo "FATAL: $BACKUP_BASE_DIR is not writable by user $(id -u):$(id -g)"
  echo "Fix: run 'sudo chown -R $(id -u):$(id -g) $BACKUP_BASE_DIR' on the host"
  exit 1
fi

# Run pending database migrations
if [ -f dist/db/datasource.js ]; then
  echo "Running database migrations..."
  node ./node_modules/.bin/typeorm migration:run -d dist/db/datasource.js 2>&1 || {
    echo "Warning: migrations failed — audit DB may be unavailable"
  }
fi

exec "$@"
