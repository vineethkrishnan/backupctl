# Help Center screenshots

Generated with [silicon](https://github.com/Aloxaf/silicon). See `docs/helpcenter/index.md#generating-screenshots` for the canonical command and style conventions.

Expected files:

| File | Article | What it shows |
|------|---------|---------------|
| `01-pg-dump-timeout-error.png` | pg_dump timeout | Audit-log entry with the `Command "pg_dump" failed` error |
| `01-version-check.png` | pg_dump timeout | `docker exec backupctl cat /app/package.json \| grep version` output |
| `01-sed-hotfix.png` | pg_dump timeout | `sed` edit + `docker compose restart backupctl` |
| `01-upgrade-complete.png` | pg_dump timeout | Final output of `backupctl-manage.sh upgrade` |
| `02-network-connect-errors.png` | Docker network connect | Three error variants side by side |
| `02-network-ls.png` | Docker network connect | `docker network ls --filter name=…` output |
| `02-docker-in-container.png` | Docker network connect | `docker ps` succeeding from inside the container after `group_add` fix |
| `02-manual-connect.png` | Docker network connect | Host-side `docker network connect …` workaround |
| `02-network-connect-all.png` | Docker network connect | `backupctl network connect` success output for all projects |
