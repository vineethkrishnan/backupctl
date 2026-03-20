# CLI Reference

backupctl provides 14 commands for managing backups, restores, health checks, configuration, and direct restic access. Every command returns structured exit codes suitable for scripting and CI/CD pipelines.

## Entry Points

**CLI shortcuts (recommended):**

```bash
backupctl <command>               # production
backupctl-dev <command>           # development
```

Install these with `./scripts/install-cli.sh`. See [Installation → CLI Shortcuts](04-installation.md#11-cli-shortcuts).

**Docker exec (without shortcuts):**

```bash
docker exec backupctl node dist/cli.js <command>          # production
docker exec backupctl-dev npx ts-node -r tsconfig-paths/register src/cli.ts <command>  # dev
```

All examples in this document use the shorthand `backupctl` for brevity.

### Global Option: --verbose / -v

Add `-v` or `--verbose` to any command to see detailed NestJS bootstrap logs, module initialization, and debug-level messages. Useful for diagnosing slow startup or connectivity issues.

```bash
backupctl -v health
backupctl --verbose run myproject --dry-run
```

Without verbose, the CLI only shows warnings and errors during bootstrap. With verbose, you see every step: module loading, DB connection, GPG key imports, notifier registration, etc.

---

## Table of Contents

- [run](#run) — trigger backup or simulate with dry run
- [status](#status) — backup status overview
- [health](#health) — system health checks
- [restore](#restore) — restore files from snapshot
- [snapshots](#snapshots) — list restic snapshots
- [prune](#prune) — manual restic prune
- [logs](#logs) — query audit logs
- [config](#config) — validate, show, reload, import GPG keys
- [cache](#cache) — restic cache management
- [restic](#restic) — restic passthrough
- [Global Behaviors](#global-behaviors) — exit codes, concurrency, logging

---

## run

Trigger a backup for a single project or all enabled projects. Supports dry run mode for pre-flight validation without executing the actual backup.

### Syntax

```
backupctl run <project> [--dry-run]
backupctl run --all
```

### Arguments & Options

| Argument / Option | Required | Description |
|-------------------|----------|-------------|
| `<project>` | Yes (unless `--all`) | Project name as defined in `config/projects.yml` |
| `--dry-run` | No | Validate config and connectivity without executing backup |
| `--all` | No | Run backups for all enabled projects sequentially |

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Backup completed successfully |
| `1` | Backup failed |
| `2` | Backup already in progress (lock held) |
| `3` | Configuration validation error |
| `4` | Connectivity error (DB, SSH, restic) |
| `5` | Partial success (with `--all`: some projects succeeded, some failed) |

### Examples

**Dry run — all checks pass:**

![backupctl run --dry-run](/images/03-dry-run.png)

```
$ backupctl run locaboo --dry-run

=== Dry Run: locaboo ===
Validating config and connectivity without executing backup.
  ✅ Config loaded — Project "locaboo" configuration is valid
  ✅ Database dumper — Adapter found for database type: postgres
  ✅ Notifier — Adapter found for notification type: slack
  ✅ Restic repo — Repository accessible at /backups/locaboo
  ✅ Disk space — 42.0 GB free (minimum: 5 GB)
  ✅ GPG key — Key found for recipient: locaboo-backup@company.com
  ✅ Asset paths — All 2 asset path(s) exist

✅ All checks passed — locaboo is ready for backup.
```

**Dry run — failure detected:**

```
$ backupctl run locaboo --dry-run

=== Dry Run: locaboo ===
Validating config and connectivity without executing backup.
  ✅ Config loaded — Project "locaboo" configuration is valid
  ✅ Database dumper — Adapter found for database type: postgres
  ✅ Notifier — Adapter found for notification type: slack
  ❌ Restic repo — Cannot access repository at /backups/locaboo: repository does not exist
  ✅ Disk space — 42.0 GB free (minimum: 5 GB)
  ✅ GPG key — Key found for recipient: locaboo-backup@company.com
  ⚠️  Asset paths — 1 of 2 path(s) missing: /data/locaboo/assets

❌ 2 check(s) failed — locaboo is NOT ready for backup.
```

**Single project backup:**

![backupctl run](/images/09-run-backup.png)

```
$ backupctl run locaboo

[2026-03-18 00:00:05] Starting backup for locaboo (run: a1b2c3d4)
[2026-03-18 00:00:05] [1/11] Sending start notification...
[2026-03-18 00:00:06] [2/11] Executing pre-backup hook...
[2026-03-18 00:00:07] [3/11] Dumping database (postgres)...
[2026-03-18 00:00:32] [4/11] Verifying dump integrity...
[2026-03-18 00:00:34] [5/11] Encrypting dump with GPG...
[2026-03-18 00:00:36] [6/11] Syncing to remote storage (combined mode)...
[2026-03-18 00:01:15] [7/11] Pruning old snapshots...
[2026-03-18 00:01:22] [8/11] Cleaning up local files...
[2026-03-18 00:01:23] [9/11] Executing post-backup hook...
[2026-03-18 00:01:24] [10/11] Recording audit log...
[2026-03-18 00:01:24] [11/11] Sending success notification...

✅ Backup completed for locaboo in 1m 19s
   Dump size: 145.2 MB | Snapshot: abc12345 | Restic repo: 1.8 GB
```

**All projects — mixed results:**

```
$ backupctl run --all

[2026-03-18 01:00:00] Running backups for 3 enabled project(s)...

[2026-03-18 01:00:00] [1/3] locaboo — starting...
[2026-03-18 01:01:19] [1/3] locaboo — ✅ completed in 1m 19s

[2026-03-18 01:01:20] [2/3] project-x — starting...
[2026-03-18 01:02:45] [2/3] project-x — ✅ completed in 1m 25s

[2026-03-18 01:02:46] [3/3] project-y — starting...
[2026-03-18 01:02:52] [3/3] project-y — ❌ failed at stage Dump: connection refused

=== Summary ===
  ✅ locaboo     — success (1m 19s)
  ✅ project-x   — success (1m 25s)
  ❌ project-y   — failed (Dump: connection refused)

⚠️  Partial success: 2 of 3 projects completed. Exit code: 5
```

**Lock collision:**

```
$ backupctl run locaboo

❌ Backup already in progress for locaboo.
   Lock held since 2026-03-18 00:00:05 (PID: 1234)
   Use "backupctl status locaboo" to check progress.

Exit code: 2
```

---

## status

Display backup status for all projects or detailed history for a single project.

### Syntax

```
backupctl status
backupctl status <project> [--last <n>]
```

### Arguments & Options

| Argument / Option | Required | Description |
|-------------------|----------|-------------|
| `<project>` | No | Show detailed history for a specific project |
| `--last <n>` | No | Number of recent runs to display (default: 10) |

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Status retrieved successfully |
| `1` | Failed to retrieve status |
| `3` | Unknown project name |

### Examples

**All projects summary:**

![backupctl status](/images/15-status-all.png)

```
$ backupctl status

PROJECT       LAST RUN              STATUS    DURATION  NEXT SCHEDULED
locaboo       2026-03-18 00:00:05   success   1m 19s    2026-03-19 00:00:00
project-x     2026-03-18 01:30:00   success   1m 25s    2026-03-19 01:30:00
project-y     2026-03-18 02:00:00   failed    6s        2026-03-19 02:00:00

3 project(s) configured. 2 healthy, 1 failing.
```

**Single project history:**

![backupctl status](/images/05-status.png)

```
$ backupctl status locaboo --last 5

=== locaboo — Backup History ===

RUN ID      STARTED               FINISHED              STATUS    DURATION  SNAPSHOT
a1b2c3d4    2026-03-18 00:00:05   2026-03-18 00:01:24   success   1m 19s    abc12345
e5f6a7b8    2026-03-17 00:00:03   2026-03-17 00:01:18   success   1m 15s    def67890
c9d0e1f2    2026-03-16 00:00:04   2026-03-16 00:01:22   success   1m 18s    ghi11223
a3b4c5d6    2026-03-15 00:00:05   2026-03-15 00:01:30   success   1m 25s    jkl44556
e7f8a9b0    2026-03-14 00:00:03   2026-03-14 00:00:48   failed    45s       —

Showing 5 of 42 runs. Last failure: 2026-03-14 (Dump: connection timeout)
```

**In-progress backup:**

```
$ backupctl status locaboo

=== locaboo — Current Status ===

🔄 Backup in progress (run: a1b2c3d4)
   Started: 2026-03-18 00:00:05 (35s ago)
   Current stage: Sync (6/11)
   Lock held by PID: 1234
```

---

## health

Run comprehensive health checks against all infrastructure dependencies. No arguments required.

### Syntax

```
backupctl health
```

### Arguments & Options

None.

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | All checks passed |
| `1` | One or more checks failed |
| `4` | Connectivity error (DB, SSH, or restic unreachable) |

### Examples

**Healthy system:**

![backupctl health](/images/01-health.png)

```
$ backupctl health

=== System Health Check ===

  ✅ Audit DB — Connected (PostgreSQL 16.2, 142 records)
  ✅ Disk space — 42.0 GB free (minimum: 5 GB)
  ✅ SSH — Connection to u123456.your-storagebox.de successful
  ✅ Restic repo (locaboo) — Repository OK, 42 snapshots
  ✅ Restic repo (project-x) — Repository OK, 28 snapshots
  ✅ Restic repo (project-y) — Repository OK, 14 snapshots

All checks passed.
```

**Degraded system:**

```
$ backupctl health

=== System Health Check ===

  ✅ Audit DB — Connected (PostgreSQL 16.2, 142 records)
  ❌ Disk space — 3.2 GB free (minimum: 5 GB)
  ✅ SSH — Connection to u123456.your-storagebox.de successful
  ✅ Restic repo (locaboo) — Repository OK, 42 snapshots
  ❌ Restic repo (project-x) — Lock detected, may need unlock
  ✅ Restic repo (project-y) — Repository OK, 14 snapshots

⚠️  2 check(s) failed. Run "backupctl restic project-x unlock" for stale locks.

Exit code: 1
```

---

## restore

Restore files from a restic snapshot to a target directory. Supports selective restore (`--only db` or `--only assets`) and provides human-readable import instructions with `--guide`.

### Syntax

```
backupctl restore <project> <snapshot-id> <target-path> [--only db|assets] [--decompress] [--guide]
```

### Arguments & Options

| Argument / Option | Required | Description |
|-------------------|----------|-------------|
| `<project>` | Yes | Project name |
| `<snapshot-id>` | Yes | Restic snapshot ID (short hash or `latest`) |
| `<target-path>` | Yes | Directory to extract files into |
| `--only db` | No | Restore only the database dump |
| `--only assets` | No | Restore only asset directories |
| `--decompress` | No | Decompress dump file after restore |
| `--guide` | No | Print database import instructions after restore |

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Restore completed successfully |
| `1` | Restore failed |
| `3` | Configuration error (unknown project) |
| `4` | Connectivity error (restic repo unreachable) |

### Examples

**Basic restore:**

```
$ backupctl restore locaboo abc12345 /tmp/restore

Restoring snapshot abc12345 for locaboo...
  Source: sftp:u123456@u123456.your-storagebox.de:/backups/locaboo
  Target: /tmp/restore

Restoring files...
  restored /tmp/restore/locaboo_db_20260318_000032.sql.gz
  restored /tmp/restore/uploads/ (1,248 files)
  restored /tmp/restore/assets/ (346 files)

✅ Restore complete. 3 items restored to /tmp/restore
```

**Latest snapshot with decompress and guide:**

```
$ backupctl restore locaboo latest /tmp/restore --decompress --guide

Restoring latest snapshot (abc12345) for locaboo...
  Source: sftp:u123456@u123456.your-storagebox.de:/backups/locaboo
  Target: /tmp/restore

Restoring files...
  restored /tmp/restore/locaboo_db_20260318_000032.sql.gz
  restored /tmp/restore/uploads/ (1,248 files)
  restored /tmp/restore/assets/ (346 files)

Decompressing dump...
  locaboo_db_20260318_000032.sql.gz → locaboo_db_20260318_000032.sql (487 MB)

✅ Restore complete.

=== Database Import Guide (postgres) ===

The dump file is a pg_dump custom-format archive. To import:

  1. Create the target database (if it doesn't exist):
     createdb -h <host> -U <user> locaboo_db

  2. Restore the dump:
     pg_restore -h <host> -U <user> -d locaboo_db /tmp/restore/locaboo_db_20260318_000032.sql

  3. If restoring to an existing database, add --clean to drop objects first:
     pg_restore -h <host> -U <user> -d locaboo_db --clean /tmp/restore/locaboo_db_20260318_000032.sql

Note: The dump was originally encrypted with GPG. It was decrypted
automatically during restore. The .sql file is ready for import.
```

**Selective restore — database only:**

```
$ backupctl restore locaboo abc12345 /tmp/restore --only db

Restoring snapshot abc12345 for locaboo (database only)...
  Source: sftp:u123456@u123456.your-storagebox.de:/backups/locaboo
  Target: /tmp/restore

Restoring files...
  restored /tmp/restore/locaboo_db_20260318_000032.sql.gz

✅ Restore complete. Database dump restored to /tmp/restore
```

**Selective restore — assets only:**

```
$ backupctl restore locaboo abc12345 /tmp/restore --only assets

Restoring snapshot abc12345 for locaboo (assets only)...
  Source: sftp:u123456@u123456.your-storagebox.de:/backups/locaboo
  Target: /tmp/restore

Restoring files...
  restored /tmp/restore/uploads/ (1,248 files)
  restored /tmp/restore/assets/ (346 files)

✅ Restore complete. Asset directories restored to /tmp/restore
```

---

## snapshots

List restic snapshots for a project. Displays snapshot ID, timestamp, tags, and size.

### Syntax

```
backupctl snapshots <project> [--last <n>]
```

### Arguments & Options

| Argument / Option | Required | Description |
|-------------------|----------|-------------|
| `<project>` | Yes | Project name |
| `--last <n>` | No | Number of recent snapshots to display (default: 20) |

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Snapshots listed successfully |
| `1` | Failed to list snapshots |
| `3` | Unknown project name |
| `4` | Restic repo unreachable |

### Examples

**Combined snapshot mode:**

![backupctl snapshots](/images/04-snapshots.png)

```
$ backupctl snapshots locaboo --last 5

=== locaboo — Restic Snapshots (combined mode) ===

SNAPSHOT     DATE                  TAGS                                    SIZE
abc12345     2026-03-18 00:01:15   backupctl:combined, project:locaboo     145.2 MB
def67890     2026-03-17 00:01:10   backupctl:combined, project:locaboo     144.8 MB
ghi11223     2026-03-16 00:01:12   backupctl:combined, project:locaboo     143.9 MB
jkl44556     2026-03-15 00:01:20   backupctl:combined, project:locaboo     145.1 MB
mno77889     2026-03-14 00:00:38   backupctl:combined, project:locaboo     142.3 MB

Showing 5 of 42 snapshots. Repository size: 1.8 GB
```

**Separate snapshot mode:**

```
$ backupctl snapshots project-x --last 5

=== project-x — Restic Snapshots (separate mode) ===

SNAPSHOT     DATE                  TAGS                                              SIZE
aaa11111     2026-03-18 01:31:15   backupctl:db, project:project-x                   82.4 MB
bbb22222     2026-03-18 01:31:45   backupctl:assets:/data/projectx/storage, ...      63.1 MB
ccc33333     2026-03-17 01:31:10   backupctl:db, project:project-x                   81.9 MB
ddd44444     2026-03-17 01:31:38   backupctl:assets:/data/projectx/storage, ...      62.8 MB
eee55555     2026-03-16 01:31:12   backupctl:db, project:project-x                   82.1 MB

Showing 5 of 56 snapshots. Repository size: 2.4 GB
```

---

## prune

Manually trigger restic prune for a project or all projects. Applies the retention policy defined in the project's YAML config.

### Syntax

```
backupctl prune <project>
backupctl prune --all
```

### Arguments & Options

| Argument / Option | Required | Description |
|-------------------|----------|-------------|
| `<project>` | Yes (unless `--all`) | Project name |
| `--all` | No | Prune all enabled projects sequentially |

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Prune completed successfully |
| `1` | Prune failed |
| `3` | Unknown project name |
| `4` | Restic repo unreachable |
| `5` | Partial success (with `--all`) |

### Examples

**Single project:**

```
$ backupctl prune locaboo

Pruning locaboo with retention: keep_daily=7, keep_weekly=4, keep_monthly=0
  Removed 3 snapshots
  Freed 412.5 MB

✅ Prune complete for locaboo. Repository: 1.4 GB (was 1.8 GB)
```

**All projects:**

```
$ backupctl prune --all

[1/3] locaboo — pruning...
  Removed 3 snapshots, freed 412.5 MB ✅
[2/3] project-x — pruning...
  Removed 5 snapshots, freed 287.3 MB ✅
[3/3] project-y — pruning...
  Removed 1 snapshot, freed 45.0 MB ✅

=== Summary ===
  Total removed: 9 snapshots
  Total freed: 744.8 MB
```

---

## logs

Query the audit trail for a project's backup history.

### Syntax

```
backupctl logs <project> [--last <n>] [--failed]
```

### Arguments & Options

| Argument / Option | Required | Description |
|-------------------|----------|-------------|
| `<project>` | Yes | Project name |
| `--last <n>` | No | Number of recent log entries (default: 20) |
| `--failed` | No | Show only failed backup runs |

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Logs retrieved successfully |
| `1` | Failed to retrieve logs |
| `3` | Unknown project name |
| `4` | Audit DB unreachable |

### Examples

**Recent logs:**

![backupctl logs](/images/10-logs.png)

```
$ backupctl logs locaboo --last 5

=== locaboo — Audit Logs ===

RUN ID      STARTED               STATUS    DURATION  LAST STAGE       ERROR
a1b2c3d4    2026-03-18 00:00:05   success   1m 19s    Notify           —
e5f6a7b8    2026-03-17 00:00:03   success   1m 15s    Notify           —
c9d0e1f2    2026-03-16 00:00:04   success   1m 18s    Notify           —
a3b4c5d6    2026-03-15 00:00:05   success   1m 25s    Notify           —
e7f8a9b0    2026-03-14 00:00:03   failed    45s       Dump             connection timeout

Showing 5 of 42 entries.
```

**Failed runs only:**

```
$ backupctl logs locaboo --last 10 --failed

=== locaboo — Failed Runs ===

RUN ID      STARTED               DURATION  FAILED STAGE   ERROR
e7f8a9b0    2026-03-14 00:00:03   45s       Dump           connection timeout
f1a2b3c4    2026-03-08 00:00:04   2m 10s    Sync           SSH connection refused
d5e6f7a8    2026-03-01 00:00:05   12s       PreHook        curl: connection refused

Showing 3 of 3 failed runs.
```

---

## config

Manage project configuration: validate syntax, display resolved config, reload from disk, and import GPG keys.

### Syntax

```
backupctl config validate
backupctl config show <project>
backupctl config reload
backupctl config import-gpg-key <file>
```

### Subcommands

| Subcommand | Description |
|------------|-------------|
| `validate` | Check all project configs for syntax and semantic errors |
| `show <project>` | Display the fully resolved config for a project (secrets masked) |
| `reload` | Reload `config/projects.yml` and `.env` without restarting the container |
| `import-gpg-key <file>` | Import a GPG public key for encryption |

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Operation successful |
| `1` | Operation failed |
| `3` | Configuration validation error (with `validate`) |

### Examples

**Validate — all valid:**

![backupctl config validate](/images/02-config-validate.png)

```
$ backupctl config validate

Validating config/projects.yml...

  ✅ locaboo — valid
  ✅ project-x — valid
  ✅ project-y — valid

All 3 project(s) are valid.
```

**Validate — errors found:**

```
$ backupctl config validate

Validating config/projects.yml...

  ✅ locaboo — valid
  ❌ project-x — 2 error(s):
     • database.password: unresolved variable ${PROJECTX_DB_PASSWORD}
     • retention.keep_daily: must be a non-negative integer
  ✅ project-y — valid

1 of 3 project(s) have errors. Exit code: 3
```

**Show resolved config (secrets masked):**

![backupctl config show](/images/08-config-show.png)

```
$ backupctl config show locaboo

=== locaboo — Resolved Configuration ===

name: locaboo
enabled: true
cron: "0 0 * * *"
timeout_minutes: 30

database:
  type: postgres
  host: postgres-locaboo
  port: 5432
  name: locaboo_db
  user: backup_user
  password: ********

compression:
  enabled: true

assets:
  paths:
    - /data/locaboo/uploads
    - /data/locaboo/assets

restic:
  repository_path: backups/locaboo
  password: ********
  snapshot_mode: combined

retention:
  local_days: 7
  keep_daily: 7
  keep_weekly: 4
  keep_monthly: 0

encryption:
  enabled: true
  type: gpg
  recipient: locaboo-backup@company.com

hooks:
  pre_backup: "curl -s http://locaboo-app:3000/maintenance/on"
  post_backup: "curl -s http://locaboo-app:3000/maintenance/off"

verification:
  enabled: true

notification:
  type: slack
  config:
    webhook_url: ********

Config source: config/projects.yml
Secrets resolved from: .env
```

**Reload config:**

```
$ backupctl config reload

Reloading configuration...
  Loaded 3 project(s) from config/projects.yml
  Resolved environment variables from .env
  Updated cron schedules

✅ Configuration reloaded. Changes take effect on next backup run.
```

**Import GPG key:**

```
$ backupctl config import-gpg-key /app/gpg-keys/locaboo-backup.pub

Importing GPG key from /app/gpg-keys/locaboo-backup.pub...
  Key ID: 0xABCDEF1234567890
  User ID: locaboo-backup@company.com
  Fingerprint: 1234 5678 ABCD EF01 2345 6789 ABCD EF12 3456 7890

✅ GPG key imported successfully.
```

---

## cache

View or clear the restic cache for a project. Useful when restic operations are slow or the cache is corrupted.

### Syntax

```
backupctl cache <project> [--clear]
backupctl cache --clear-all
```

### Arguments & Options

| Argument / Option | Required | Description |
|-------------------|----------|-------------|
| `<project>` | Yes (unless `--clear-all`) | Project name |
| `--clear` | No | Clear the cache for the specified project |
| `--clear-all` | No | Clear cache for all projects |

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Operation successful |
| `1` | Operation failed |
| `3` | Unknown project name |

### Examples

**Show cache info:**

![backupctl cache](/images/07-cache.png)

```
$ backupctl cache locaboo

=== locaboo — Restic Cache ===

Cache directory: /root/.cache/restic/abc123def456
Size: 28.5 MB
Last accessed: 2026-03-18 00:01:22
```

**Clear single project cache:**

```
$ backupctl cache locaboo --clear

Clearing restic cache for locaboo...
  Removed 28.5 MB from /root/.cache/restic/abc123def456

✅ Cache cleared for locaboo.
```

**Clear all caches:**

```
$ backupctl cache --clear-all

Clearing restic cache for all projects...
  locaboo — 28.5 MB cleared
  project-x — 15.2 MB cleared
  project-y — 12.1 MB cleared

✅ Cache cleared for 3 project(s). Total freed: 55.8 MB
```

---

## restic

Execute restic commands directly against a project's repository. The repository path, password, and SFTP credentials are injected automatically from the project's config — you only supply the restic subcommand and its arguments.

### Syntax

```
backupctl restic <project> <cmd> [args...]
```

### Arguments & Options

| Argument / Option | Required | Description |
|-------------------|----------|-------------|
| `<project>` | Yes | Project name (used to resolve repo path and credentials) |
| `<cmd>` | Yes | Restic subcommand to execute |
| `[args...]` | No | Additional arguments passed through to restic |

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Restic command succeeded |
| `1` | Restic command failed |
| `3` | Unknown project name |
| `4` | Repository unreachable |

### Examples

**List snapshots:**

![backupctl restic snapshots](/images/13-restic-snapshots.png)

```
$ backupctl restic locaboo snapshots

repository abc12345 opened (version 2, compression auto)
ID        Time                 Host        Tags                                    Paths
-----------------------------------------------------------------------------------------------------------------------
abc12345  2026-03-18 00:01:15  backupctl   backupctl:combined,project:locaboo      /data/backups/locaboo
def67890  2026-03-17 00:01:10  backupctl   backupctl:combined,project:locaboo      /data/backups/locaboo
ghi11223  2026-03-16 00:01:12  backupctl   backupctl:combined,project:locaboo      /data/backups/locaboo
-----------------------------------------------------------------------------------------------------------------------
3 snapshots
```

**Check repository integrity:**

![backupctl restic check](/images/06-restic-check.png)

```
$ backupctl restic locaboo check

using temporary cache in /tmp/restic-check-cache-123456
repository abc12345 opened (version 2, compression auto)
created new cache in /tmp/restic-check-cache-123456
create exclusive lock for repository
load indexes
check all packs
check snapshots, trees and blobs
no errors were found
```

**Repository statistics:**

![backupctl restic stats](/images/11-restic-stats.png)

```
$ backupctl restic locaboo stats

repository abc12345 opened (version 2, compression auto)
scanning...
Stats in restore-size mode:
     Snapshots processed:   42
        Total File Count:   15234
              Total Size:   4.812 GiB
```

**List files in latest snapshot:**

![backupctl restic ls latest](/images/12-restic-ls.png)

```
$ backupctl restic locaboo ls latest

snapshot abc12345 of [/data/backups/locaboo] at 2026-03-18 00:01:15
/data/backups/locaboo
/data/backups/locaboo/locaboo_db_20260318_000032.sql.gz.gpg
/data/backups/locaboo/uploads
/data/backups/locaboo/uploads/image001.jpg
...
```

**Find a specific file across snapshots:**

![backupctl restic find](/images/14-restic-find.png)

```
$ backupctl restic locaboo find "*.sql.gz"

Found matching entries in snapshot abc12345 from 2026-03-18 00:01:15
  /data/backups/locaboo/locaboo_db_20260318_000032.sql.gz.gpg

Found matching entries in snapshot def67890 from 2026-03-17 00:01:10
  /data/backups/locaboo/locaboo_db_20260317_000028.sql.gz.gpg
```

**Unlock stale locks:**

```
$ backupctl restic locaboo unlock

repository abc12345 opened (version 2, compression auto)
successfully removed 1 locks
```

**Initialize a new repository:**

```
$ backupctl restic locaboo init

created restic repository abc12345 at sftp:u123456@u123456.your-storagebox.de:/backups/locaboo

Please note that knowledge of your password is required to access
the repository. Losing your password means that your data is
irrecoverably lost.
```

**Mount repository for browsing (interactive):**

```
$ backupctl restic locaboo mount /mnt/restic

repository abc12345 opened (version 2, compression auto)
Now serving the repository at /mnt/restic
Use another terminal or file manager to browse the snapshots.
When finished, press Ctrl-C or send SIGINT to quit.
```

---

## Global Behaviors

### Exit Codes

All commands follow a consistent exit code scheme:

| Code | Meaning | Commands |
|------|---------|----------|
| `0` | Success | All commands |
| `1` | General failure | All commands |
| `2` | Backup already in progress (lock held) | `run` |
| `3` | Configuration validation error | `run`, `status`, `restore`, `snapshots`, `prune`, `logs`, `config`, `cache`, `restic` |
| `4` | Connectivity error (DB, SSH, restic) | `run`, `health`, `restore`, `snapshots`, `prune`, `logs`, `restic` |
| `5` | Partial success | `run --all`, `prune --all` |

Use exit codes for scripting:

```bash
backupctl run locaboo
case $? in
  0) echo "Backup succeeded" ;;
  1) echo "Backup failed" ;;
  2) echo "Already running" ;;
  3) echo "Config error" ;;
  4) echo "Connectivity issue" ;;
esac
```

### Concurrency Model

backupctl uses per-project file-based locks to prevent concurrent backups of the same project:

- **Lock location:** `{BACKUP_BASE_DIR}/{project}/.lock`
- **Cron-triggered overlap:** If a scheduled backup fires while a previous run is still active, the new run queues behind it and starts when the lock is released.
- **CLI-triggered collision:** If you manually trigger `backupctl run <project>` while a backup is already running, the command rejects immediately with exit code `2`.
- **`run --all`:** Projects are backed up sequentially in the order they appear in `config/projects.yml`. If one project fails, the next project still runs. Exit code `5` indicates partial success.
- **Stale locks:** If the container crashes mid-backup, `RecoverStartupUseCase` cleans up orphaned `.lock` files on the next start.

### Log Output

- **Console:** All commands write structured output to stdout. Errors go to stderr.
- **Verbose mode:** Add `-v` or `--verbose` to any command to see NestJS bootstrap logs, module initialization, DB connections, and debug messages. Without it, the CLI suppresses all bootstrap noise and only shows warnings/errors.
- **Log files:** The background service writes JSON-formatted logs (via Winston) to `{LOG_DIR}/backupctl-YYYY-MM-DD.log` with daily rotation.
- **Log level:** Controlled by the `LOG_LEVEL` environment variable (default: `info`). The `-v` flag overrides this to `debug` for the current invocation.
- **Max size / rotation:** Controlled by `LOG_MAX_SIZE` (default: `10m`) and `LOG_MAX_FILES` (default: `5`).

### Timezone

All timestamps in CLI output, log files, audit records, and file names use the timezone defined by the `TIMEZONE` environment variable (default: `Europe/Berlin`). Set this in your `.env` file to match your operational timezone.

---

## Getting Help

- **Command not working?** — [Troubleshooting](12-troubleshooting.md) covers common errors
- **Setup issues?** — [FAQ](15-faq.md) for SSH, GPG, Docker networking, and restic problems
- **Still stuck?** — **[Report an issue on GitHub](https://github.com/vineethkrishnan/backupctl/issues/new)**

## What's Next

- **Understand the backup pipeline** — [Backup Flow](08-backup-flow.md) explains each of the 11 steps.
- **Recover from a snapshot** — [Restore Guide](09-restore-guide.md) covers browsing snapshots and importing dumps.
- **Host management** — [Bash Scripts](07-bash-scripts.md) documents `deploy.sh` and `backupctl-manage.sh`.
- **Quick commands** — [Cheatsheet](10-cheatsheet.md) for copy-paste daily operations.
