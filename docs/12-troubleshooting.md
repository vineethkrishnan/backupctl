# Troubleshooting

## Backup Stuck / Lock Not Released

**Symptom:** `backupctl run myproject` exits with code `2` and the message "Backup already in progress." No backup is actually running.

**Diagnosis:**

```bash
# Check if a backup process is actually running
docker exec backupctl ps aux | grep "node dist/cli.js"

# Check the lock file
docker exec backupctl ls -la /data/backups/myproject/.lock

# Check audit log for orphaned "started" records
backupctl logs myproject --last 1
```

**Fix:**

If no backup process is running and the lock file is stale (left over from a crash or container restart):

```bash
# Remove the stale lock
docker exec backupctl rm /data/backups/myproject/.lock

# Or restart the container — startup recovery auto-cleans stale locks
docker compose restart backupctl
```

Startup recovery (`StartupRecoveryService`) runs on every container start and removes stale `.lock` files, so a restart is often the cleanest fix.

## Restic Repository Locked

**Symptom:** Backup fails during the sync stage with a restic error: "repository is already locked."

**Diagnosis:**

```bash
# Check the restic lock
backupctl restic myproject check
```

**Fix:**

```bash
# Unlock the repository
backupctl restic myproject unlock
```

If unlocking fails, the restic lock file on the remote storage may be corrupted. In that case, use the `--remove-all` flag (use with caution):

```bash
backupctl restic myproject unlock --remove-all
```

Startup recovery also auto-unlocks restic repos on container start.

## SSH Connection Refused

**Symptom:** Backup fails at the sync stage with "Connection refused" or "Host key verification failed." Health check reports SSH as unhealthy.

**Diagnosis:**

```bash
# Test SSH connectivity from inside the container
docker exec backupctl ssh -T -o ConnectTimeout=5 user@storage-box.example.com

# Check known_hosts
docker exec backupctl cat /root/.ssh/known_hosts

# Check key permissions
docker exec backupctl ls -la /root/.ssh/
```

**Fix:**

1. **Connection refused** — verify the storage box host and port are correct in your config. Check if the storage box is online and accepting connections.

2. **Host key verification failed** — the storage box's host key has changed or is not in `known_hosts`. Add it:

```bash
docker exec backupctl ssh-keyscan -H storage-box.example.com >> /root/.ssh/known_hosts
```

3. **Permission denied** — verify your SSH key is correctly mounted and has the right permissions:

```bash
# Keys must be readable only by owner
docker exec backupctl chmod 600 /root/.ssh/id_*
```

4. **Key not mounted** — check that `ssh-keys/` is correctly mounted in `docker-compose.yml` and contains the private key.

## Audit Database Unreachable

**Symptom:** Health check reports the audit database as unhealthy. Log messages show "Connection refused" or "ECONNREFUSED" for PostgreSQL.

**Diagnosis:**

```bash
# Check if the audit DB container is running
docker compose ps backupctl-audit-db

# Check audit DB logs
docker compose logs backupctl-audit-db

# Test connectivity from inside the backupctl container
docker exec backupctl pg_isready -h backupctl-audit-db -p 5432
```

**Fix:**

1. **Container not running** — start it:

```bash
docker compose up -d backupctl-audit-db
```

2. **Connection credentials wrong** — verify `AUDIT_DB_HOST`, `AUDIT_DB_PORT`, `AUDIT_DB_USER`, `AUDIT_DB_PASSWORD`, and `AUDIT_DB_NAME` in `.env` match the audit DB container configuration.

3. **Database not initialized** — run migrations:

```bash
docker exec backupctl npx typeorm migration:run -d dist/infrastructure/persistence/audit/data-source.js
```

**Important:** Backups still succeed when the audit database is down. Audit entries are written to the JSONL fallback file at `/data/backups/.fallback-audit/fallback.jsonl` and automatically replayed when the audit database comes back online (on the next container startup).

## GPG Key Not Found

**Symptom:** Backup fails at the encrypt stage with "No public key" or "unusable public key." The project has `encryption.enabled: true` in its config.

**Diagnosis:**

```bash
# List keys in the GPG keyring inside the container
docker exec backupctl gpg --list-keys

# Check for the specific recipient
docker exec backupctl gpg --list-keys backup@company.com

# Check if keys are mounted
docker exec backupctl ls -la /app/gpg-keys/
```

**Fix:**

1. **Key not imported** — import the key:

```bash
backupctl config import-gpg-key /path/to/key.pub.gpg
```

Or from inside the container:

```bash
docker exec backupctl gpg --import /app/gpg-keys/backup-key.pub.gpg
```

2. **Key not mounted** — verify `gpg-keys/` is mounted in `docker-compose.yml` and contains the `.gpg` key file. Startup recovery auto-imports keys from the `GPG_KEYS_DIR` directory.

3. **Wrong recipient** — check that the `encryption.gpg_recipient` value in your project config matches the UID or email on the GPG key.

4. **Key expired** — generate a new key or extend the expiration date, then re-import.

## Config Validation Errors

**Symptom:** `backupctl config validate` reports errors, or `backupctl run` exits with code `3`.

**Diagnosis:**

```bash
backupctl config validate
```

**Common causes:**

1. **Unresolved `${}` variables** — an environment variable referenced in `projects.yml` is not defined in `.env`:

```
Error: Unresolved variable ${DB_PASSWORD} in project "myproject"
```

Fix: add the variable to `.env` or check for typos in the variable name.

2. **Invalid cron expression** — the `schedule` field has an invalid cron syntax:

```
Error: Invalid cron expression "0 3 * *" in project "myproject"
```

Fix: cron requires 5 or 6 fields (minute, hour, day-of-month, month, day-of-week, optional seconds).

3. **Missing required fields** — a project is missing required configuration:

```
Error: Missing "database.host" in project "myproject"
```

Fix: add the missing field to the project's YAML config.

4. **Unknown database type** — the `type` field doesn't match any registered dumper:

```
Error: Unknown database type "redis" in project "myproject"
```

Fix: use one of the supported types (`postgres`, `mysql`, `mongo`).

5. **Config not reloaded** — changes to `projects.yml` require an explicit reload:

```bash
backupctl config reload
```

## Disk Space Full

**Symptom:** Backup fails at the dump stage with "No space left on device." Health check reports disk as unhealthy.

**Diagnosis:**

```bash
# Check disk space inside the container
docker exec backupctl df -h /data/backups

# Check the largest backup directories
docker exec backupctl du -sh /data/backups/*/

# Check restic cache size
backupctl cache myproject
```

**Fix:**

1. **Prune old snapshots** — remove snapshots beyond the retention policy:

```bash
backupctl prune myproject
backupctl prune --all
```

2. **Clear restic cache** — the cache can grow large over time:

```bash
backupctl cache myproject --clear
backupctl cache --clear-all
```

3. **Clean up old dump files** — local dumps should be cleaned automatically, but check for orphaned files:

```bash
docker exec backupctl find /data/backups -name "*.dump" -o -name "*.sql.gz" -o -name "*.archive" | head -20
```

4. **Increase disk space** — if the volume is too small for your backup needs, expand it at the host or cloud provider level.

5. **Adjust retention** — if disk fills up regularly, reduce `keep_daily`, `keep_weekly`, or `keep_monthly` in the project's retention config.

## Backup Timeout Warning

**Symptom:** A notification warns that a backup exceeded its configured timeout. The backup run shows a warning in the audit log.

**What this means:** The backup took longer than the `timeout_minutes` value in the project config. This is a **warning, not a failure** — backupctl does not kill the backup process when the timeout is exceeded. The backup continues to run, and a `notifyWarning()` is sent to the configured notification channel.

**Fix:**

If the timeout warning is expected (e.g., a large database dump), increase the threshold:

```yaml
projects:
  myproject:
    timeout_minutes: 120  # increase from default
```

If the backup is genuinely taking too long, investigate the root cause:

- Check database size and whether it has grown unexpectedly
- Check network bandwidth to the storage box
- Check if another process is competing for I/O
- Consider whether the database needs maintenance (vacuum, optimize)

## Partial Success (Exit Code 5)

**Symptom:** `backupctl run --all` exits with code `5`.

**What this means:** When running all projects, some backups succeeded and some failed. Exit code `5` signals partial success — at least one project failed, but others completed normally.

**Diagnosis:**

```bash
# Check which projects failed
backupctl status --last 1

# Check logs for failed projects
backupctl logs failedproject --failed
```

**Fix:** Investigate each failed project individually. The failure is project-specific — it could be a database connectivity issue, SSH problem, or any of the other issues in this guide. Fix the underlying issue and re-run the failed project:

```bash
backupctl run failedproject
```

## Container Won't Start

**Symptom:** `docker compose up -d` starts the container but it immediately exits. `docker compose ps` shows the container as "Exited."

**Diagnosis:**

```bash
docker compose logs backupctl
```

**Common causes:**

1. **Port conflict** — another service is using the same port:

```
Error: listen EADDRINUSE: address already in use :::3000
```

Fix: change the `PORT` in `.env` or stop the conflicting service.

2. **Audit database not ready** — the backupctl container started before the audit DB finished initializing:

```
Error: Connection refused at backupctl-audit-db:5432
```

Fix: the `docker-compose.yml` should have `depends_on` with a health check. If the DB is slow to start, restart backupctl after the DB is healthy:

```bash
docker compose restart backupctl
```

3. **Missing `.env` file** — the container requires `.env` for database credentials and configuration:

```
Error: Missing required environment variable AUDIT_DB_PASSWORD
```

Fix: create the `.env` file. Use the setup wizard for a guided experience:

```bash
./scripts/backupctl-manage.sh setup
```

4. **Invalid `projects.yml`** — syntax errors in the YAML config prevent startup:

Fix: validate the YAML syntax and fix any errors. Check for tabs (YAML requires spaces) and proper indentation.

5. **Missing mounted volumes** — required directories (`config/`, `ssh-keys/`) don't exist on the host:

Fix: create the directories:

```bash
mkdir -p config ssh-keys gpg-keys
```

## Debug Commands

Quick reference for diagnosing issues:

```bash
# Container logs (real-time)
docker compose logs -f backupctl

# Application logs (today)
docker exec backupctl cat /data/backups/.logs/backupctl-$(date +%Y-%m-%d).log

# Check lock files
docker exec backupctl find /data/backups -name ".lock" -ls

# Check fallback audit entries
docker exec backupctl cat /data/backups/.fallback-audit/fallback.jsonl

# Force remove a stale lock
docker exec backupctl rm /data/backups/myproject/.lock

# Restic repository diagnostics
backupctl restic myproject check
backupctl restic myproject unlock
backupctl restic myproject stats

# GPG diagnostics
docker exec backupctl gpg --list-keys
docker exec backupctl gpg --list-keys backup@company.com

# Database connectivity
docker exec backupctl pg_isready -h backupctl-audit-db -p 5432

# SSH connectivity
docker exec backupctl ssh -T -o ConnectTimeout=5 user@storage-box.example.com

# Disk space
docker exec backupctl df -h /data/backups
docker exec backupctl du -sh /data/backups/*/

# Environment variables
docker exec backupctl env | sort
```

## Log Locations

| Location | Contents |
|----------|----------|
| Container stdout | Real-time CLI output and NestJS logs |
| `/data/backups/.logs/` | Winston JSON logs with daily rotation |
| `/data/backups/.fallback-audit/fallback.jsonl` | JSONL fallback audit entries (when audit DB is down) |
| Docker logs | `docker compose logs backupctl` |

Winston logs use JSON format in production and pretty-printed format in development. Log files are rotated daily and named `backupctl-YYYY-MM-DD.log`.

## Getting More Help

Start with these commands to narrow down the problem:

```bash
# System-wide health overview
backupctl health

# Config validation
backupctl config validate

# Pre-flight check (validates without executing)
backupctl run myproject --dry-run

# Recent backup history
backupctl status myproject --last 5

# Failed backup details
backupctl logs myproject --failed
```

If the issue is specific to a backup stage, consult [Backup Flow](08-backup-flow.md) to understand what happens at each step and which adapter is involved.

## What's Next

- **Quick commands** — [Cheatsheet](10-cheatsheet.md) for copy-paste diagnostics and daily operations.
- **Full command syntax** — [CLI Reference](06-cli-reference.md) for all flags and options.
- **Understand the flow** — [Backup Flow](08-backup-flow.md) for the 11-step pipeline and where failures can occur.
