#!/bin/sh
set -e

BACKUP_BASE_DIR="${BACKUP_BASE_DIR:-/data/backups}"

# Ensure backup directories exist
mkdir -p "$BACKUP_BASE_DIR/.logs" 2>/dev/null || true
mkdir -p "$BACKUP_BASE_DIR/.fallback-audit" 2>/dev/null || true

# Run pending database migrations
if [ -f dist/db/datasource.js ]; then
  echo "Running database migrations..."
  npx typeorm migration:run -d dist/db/datasource.js 2>&1 || {
    echo "Warning: migrations failed — audit DB may be unavailable"
  }
fi

exec "$@"
