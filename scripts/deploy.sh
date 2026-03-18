#!/bin/bash
set -e

echo "=== backupctl deploy ==="

echo "[1/4] Validating config..."
docker exec backupctl node dist/cli.js config validate 2>/dev/null || echo "Container not running, skipping validation"

echo "[2/4] Building Docker image..."
docker compose -f docker-compose.yml build

echo "[3/4] Starting containers..."
docker compose -f docker-compose.yml up -d

echo "[4/4] Running health check..."
sleep 5
docker exec backupctl node dist/cli.js health

echo "=== backupctl deployed successfully ==="
