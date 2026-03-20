# Configuration

backupctl configuration is split between two files: `.env` for global settings and secrets, and `config/projects.yml` for per-project settings. Secrets always live in `.env` and are referenced in YAML via `${VAR_NAME}` syntax, which is resolved at load time.

Configuration changes are never hot-reloaded. After modifying either file, run `backupctl config reload` to apply changes and re-register cron schedules.

## Environment Variables (.env)

### Application

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_PORT` | `3100` | HTTP port for health and status endpoints |
| `TIMEZONE` | `Europe/Berlin` | Timezone for file names, audit timestamps, notifications, and logs |
| `BACKUP_BASE_DIR` | `/data/backups` | Base directory for all backup data, lock files, fallback audit, and logs |
| `LOG_LEVEL` | `info` | Logging level: `debug`, `info`, `warn`, `error` |
| `LOG_DIR` | `/data/backups/.logs` | Directory for log files (Winston daily rotate) |
| `LOG_MAX_SIZE` | `10m` | Maximum size per log file before rotation |
| `LOG_MAX_FILES` | `5` | Number of rotated log files to keep |

### Audit Database

| Variable | Default | Description |
|----------|---------|-------------|
| `AUDIT_DB_HOST` | `backupctl-audit-db` | PostgreSQL host (matches Docker Compose service name) |
| `AUDIT_DB_PORT` | `5432` | PostgreSQL port |
| `AUDIT_DB_NAME` | `backup_audit` | Database name |
| `AUDIT_DB_USER` | `audit_user` | Database user |
| `AUDIT_DB_PASSWORD` | — | **Required.** Database password |

### Hetzner Storage Box

| Variable | Default | Description |
|----------|---------|-------------|
| `HETZNER_SSH_HOST` | — | **Required.** Storage box hostname (e.g., `u123456.your-storagebox.de`) |
| `HETZNER_SSH_USER` | — | **Required.** Storage box SSH user (e.g., `u123456`) |
| `HETZNER_SSH_PORT` | `23` | SSH port for the storage box |
| `HETZNER_SSH_KEY_PATH` | `/home/node/.ssh/id_ed25519` | Path to SSH private key inside the container |

### Restic

| Variable | Default | Description |
|----------|---------|-------------|
| `RESTIC_PASSWORD` | — | **Required.** Global restic repository password. Overridable per project in YAML |

### Retry

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKUP_RETRY_COUNT` | `3` | Maximum retry attempts for retryable stages (3–8) |
| `BACKUP_RETRY_DELAY_MS` | `5000` | Base delay between retries in milliseconds (exponential backoff) |

### Notification Defaults

These are used when a project has no `notification` block in YAML.

| Variable | Default | Description |
|----------|---------|-------------|
| `NOTIFICATION_TYPE` | `slack` | Default notification channel: `slack`, `email`, `webhook` |
| `SLACK_WEBHOOK_URL` | — | Slack incoming webhook URL |
| `SMTP_HOST` | — | SMTP server hostname |
| `SMTP_PORT` | `587` | SMTP server port |
| `SMTP_SECURE` | `true` | Enable TLS/STARTTLS (`true` or `false`) |
| `SMTP_TO` | — | Recipient email address |
| `SMTP_FROM` | — | Sender email address |
| `SMTP_USER` | — | SMTP authentication username (if required) |
| `SMTP_PASSWORD` | — | SMTP authentication password |
| `WEBHOOK_URL` | — | Webhook endpoint URL |

### Encryption Defaults

These are used when a project has no `encryption` block in YAML.

| Variable | Default | Description |
|----------|---------|-------------|
| `ENCRYPTION_ENABLED` | `false` | Enable GPG encryption globally |
| `ENCRYPTION_TYPE` | `gpg` | Encryption type (only `gpg` supported in v1) |
| `GPG_RECIPIENT` | — | GPG key recipient identifier (email or key ID) |
| `GPG_KEYS_DIR` | `/app/gpg-keys` | Directory for GPG public key files (auto-imported on startup) |

### Health

| Variable | Default | Description |
|----------|---------|-------------|
| `HEALTH_DISK_MIN_FREE_GB` | `5` | Minimum free disk space in GB before health check fails |

### Daily Summary

| Variable | Default | Description |
|----------|---------|-------------|
| `DAILY_SUMMARY_CRON` | `0 8 * * *` | Cron expression for the daily backup summary notification |

### Project Secrets

Project-specific secrets follow the naming pattern `{PROJECT}_DB_PASSWORD` and `{PROJECT}_RESTIC_PASSWORD` (uppercase project name with hyphens replaced by underscores):

```env
LOCABOO_DB_PASSWORD=secret
LOCABOO_RESTIC_PASSWORD=restic-secret
PROJECTX_DB_PASSWORD=secret
PROJECTY_DB_PASSWORD=secret
```

These are referenced in `projects.yml` via `${LOCABOO_DB_PASSWORD}`.

## Project Configuration (projects.yml)

The file defines an array of projects under the `projects` key. Each project must have at least one of `database` or `assets` configured. This supports three backup modes:

- **Database + files** — dumps a database and syncs asset directories
- **Database only** — dumps a database (no asset files)
- **Files only** — syncs asset directories (no database dump)

### Top-Level Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | yes | — | Unique project identifier. Lowercase, hyphens allowed. Used in directory names, lock files, audit records, and notifications |
| `enabled` | boolean | no | `true` | Whether this project is active. Disabled projects are skipped by the scheduler and `run --all` |
| `cron` | string | yes | — | 5-field cron expression defining the backup schedule |
| `timeout_minutes` | number | no | — | If set, a warning notification fires when the backup exceeds this duration. The backup continues running |
| `docker_network` | string | no | — | Docker network name where this project's database is reachable. On startup, backupctl auto-connects to this network. If omitted, the database is assumed reachable via the host or an already-connected network |

### Database

Optional. When omitted, the project operates in files-only mode — dump, verify, and encrypt stages are skipped entirely.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `database.type` | string | yes | Database type: `postgres`, `mysql`, `mongodb` |
| `database.host` | string | yes | Database hostname (Docker service name or IP) |
| `database.port` | number | yes | Database port |
| `database.name` | string | yes | Database name to dump |
| `database.user` | string | yes | Database user with backup privileges |
| `database.password` | string | yes | Database password (use `${VAR_NAME}` to reference `.env`) |

### Compression

Only applies when `database` is configured.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `compression.enabled` | boolean | no | `true` | Whether to compress dumps. Defaults to `true` — a per-project override is only needed to disable |

### Assets

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `assets.paths` | string[] | no | `[]` | Filesystem paths to include in the backup alongside the database dump (or as the sole backup target for files-only projects). Paths that don't exist at backup time are skipped with a warning |

### Restic

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `restic.repository_path` | string | yes | — | Path on the Hetzner Storage Box for this project's restic repo. **Must be relative** (e.g., `backups/myproject`, not `/backups/myproject`) — Hetzner Storage Box chroots to the user home directory |
| `restic.password` | string | no | `RESTIC_PASSWORD` from `.env` | Per-project restic repo password |
| `restic.snapshot_mode` | string | no | `combined` | `combined` (one snapshot for dump + assets) or `separate` (individual snapshots) |

### Retention

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `retention.local_days` | number | yes | — | Days to keep local dump files before cleanup |
| `retention.keep_daily` | number | yes | — | Daily snapshots to keep in restic |
| `retention.keep_weekly` | number | no | `0` | Weekly snapshots to keep in restic |
| `retention.keep_monthly` | number | no | `0` | Monthly snapshots to keep in restic |

### Encryption

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `encryption.enabled` | boolean | no | `ENCRYPTION_ENABLED` from `.env` | Enable GPG encryption for this project |
| `encryption.type` | string | no | `gpg` | Encryption type (only `gpg` in v1) |
| `encryption.recipient` | string | no | `GPG_RECIPIENT` from `.env` | GPG key recipient for encryption |

### Hooks

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `hooks.pre_backup` | string | no | Shell command to execute before the backup starts |
| `hooks.post_backup` | string | no | Shell command to execute after the backup completes |

Hooks run via `child_process.execFile` — no shell injection. Configured timeouts are enforced.

### Verification

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `verification.enabled` | boolean | no | `false` | Enable dump verification after dumping |

### Notification

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `notification.type` | string | no | `NOTIFICATION_TYPE` from `.env` | Channel type: `slack`, `email`, `webhook` |
| `notification.config` | object | no | Values from `.env` | Channel-specific configuration (see examples below) |

If the entire `notification` block is absent, the global notification channel from `.env` is used.

## Config Resolution Rules

1. **Project YAML > .env global > hardcoded defaults** — project-level values always take priority.
2. **`${VAR_NAME}` resolved from `.env`** at config load time.
3. **Secrets always in `.env`** — referenced via `${}` in YAML. Never put passwords directly in YAML.
4. **Missing `notification` block** — uses `NOTIFICATION_TYPE` + channel config from `.env`.
5. **Missing `encryption` block** — uses `ENCRYPTION_ENABLED` / `ENCRYPTION_TYPE` / `GPG_RECIPIENT` from `.env`.
6. **Missing `restic.password`** — uses `RESTIC_PASSWORD` from `.env`.
7. **`compression.enabled` defaults to `true`** — compression is always on unless explicitly disabled.
8. **Config changes require `backupctl config reload`** — no hot-reload or file watching.

## Cron Expression Examples

The `cron` field uses standard 5-field cron syntax (minute, hour, day-of-month, month, day-of-week):

| Expression | Schedule |
|-----------|----------|
| `0 2 * * *` | Daily at 2:00 AM |
| `0 */6 * * *` | Every 6 hours |
| `30 1 * * 1-5` | Weekdays at 1:30 AM |
| `0 0 * * 0` | Weekly on Sunday at midnight |
| `0 3 1 * *` | Monthly on the 1st at 3:00 AM |
| `0 0,12 * * *` | Twice daily at midnight and noon |
| `*/30 * * * *` | Every 30 minutes |

Times are interpreted in the timezone set by the `TIMEZONE` environment variable (default `Europe/Berlin`).

## Snapshot Modes

### Combined (default)

A single restic snapshot contains both the database dump and all asset paths. Tagged with `backupctl:combined,project:{name}`.

```yaml
restic:
  snapshot_mode: combined
```

Pros: simpler management, one snapshot per backup run, atomic restore.

Cons: any change in assets triggers a new snapshot even if the DB hasn't changed.

### Separate

Individual restic snapshots for the database dump and each asset path. The dump snapshot is tagged `backupctl:db,project:{name}`. Each asset snapshot is tagged `backupctl:assets:{path},project:{name}`.

```yaml
restic:
  snapshot_mode: separate
```

Pros: independent retention and restore per data type, better deduplication when assets change frequently.

Cons: more snapshots to manage, restore requires specifying `--only db` or `--only assets`.

## Notification Configuration Examples

### Slack

```yaml
notification:
  type: slack
  config:
    webhook_url: https://hooks.slack.com/services/T.../B.../xxx
```

### Email

```yaml
notification:
  type: email
  config:
    smtp_host: smtp.gmail.com
    smtp_port: 587
    smtp_secure: true
    to: devops@company.com
    from: backup@company.com
    password: ${SMTP_PASSWORD}
```

The `smtp_secure` field controls TLS: `true` enables TLS/STARTTLS, `false` sends in plain text. Always use `true` in production.

### Webhook

```yaml
notification:
  type: webhook
  config:
    url: https://api.company.com/hooks/backupctl
```

The webhook notifier POSTs `application/json` with an `event` field, a `text` field (markdown-formatted), and a structured `data` object.

## Encryption Configuration

### Per-Project

```yaml
encryption:
  enabled: true
  type: gpg
  recipient: locaboo-backup@company.com
```

### Global (via .env)

```env
ENCRYPTION_ENABLED=true
ENCRYPTION_TYPE=gpg
GPG_RECIPIENT=backup@company.com
```

When a project has no `encryption` block, these global values apply. When a project explicitly sets `encryption.enabled: false`, encryption is disabled for that project regardless of the global setting.

GPG public key files placed in `gpg-keys/` are auto-imported into the container's keyring on every startup. Use `backupctl config import-gpg-key <file>` for runtime imports.

## Complete Multi-Project Example

A full `config/projects.yml` with three projects using different databases and settings:

```yaml
projects:
  # PostgreSQL with full configuration
  - name: locaboo
    enabled: true
    cron: "0 0 * * *"
    timeout_minutes: 30
    docker_network: locaboo_locaboo-network

    database:
      type: postgres
      host: postgres-locaboo
      port: 5432
      name: locaboo_db
      user: backup_user
      password: ${LOCABOO_DB_PASSWORD}

    compression:
      enabled: true

    assets:
      paths:
        - /data/locaboo/uploads
        - /data/locaboo/assets

    restic:
      repository_path: backups/locaboo
      password: ${LOCABOO_RESTIC_PASSWORD}
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
        webhook_url: https://hooks.slack.com/services/LOCABOO/SPECIFIC/HOOK

  # MySQL with email notifications and separate snapshots
  - name: project-x
    enabled: true
    cron: "30 1 * * *"

    database:
      type: mysql
      host: mysql-projectx
      port: 3306
      name: projectx_db
      user: backup_user
      password: ${PROJECTX_DB_PASSWORD}

    assets:
      paths:
        - /data/projectx/storage

    restic:
      repository_path: backups/project-x
      snapshot_mode: separate

    retention:
      local_days: 14
      keep_daily: 14
      keep_weekly: 8

    notification:
      type: email
      config:
        smtp_host: smtp.gmail.com
        smtp_port: 587
        smtp_secure: true
        to: devops@company.com
        from: backup@company.com
        password: ${SMTP_PASSWORD}

  # MongoDB with global defaults (no overrides)
  - name: analytics
    enabled: true
    cron: "0 3 * * *"

    database:
      type: mongodb
      host: mongo-analytics
      port: 27017
      name: analytics_db
      user: backup_user
      password: ${ANALYTICS_DB_PASSWORD}

    assets:
      paths: []

    restic:
      repository_path: backups/analytics
      snapshot_mode: combined

    retention:
      local_days: 7
      keep_daily: 7
      keep_weekly: 4

    # No encryption block → uses ENCRYPTION_ENABLED from .env
    # No notification block → uses NOTIFICATION_TYPE + config from .env

  # Files-only project (no database) — syncs asset directories only
  - name: static-assets
    enabled: true
    cron: "0 4 * * *"

    assets:
      paths:
        - /data/static/uploads
        - /data/static/media

    restic:
      repository_path: backups/static-assets
      snapshot_mode: combined

    retention:
      local_days: 14
      keep_daily: 14
      keep_weekly: 4
```

## Directory Structure

backupctl organizes all data under `BACKUP_BASE_DIR` (default `/data/backups`):

```
${BACKUP_BASE_DIR}/
├── locaboo/
│   ├── locaboo_backup_20260318_000000_a1b2.sql.gz       # compressed dump
│   ├── locaboo_backup_20260318_000000_a1b2.sql.gz.gpg   # encrypted dump (if enabled)
│   ├── locaboo_backup_20260317_000000_c3d4.sql.gz
│   └── .lock                                             # present while backup is running
├── project-x/
│   ├── project-x_backup_20260318_013000_e5f6.sql.gz
│   └── .lock
├── analytics/
│   └── ...
├── .fallback-audit/
│   └── fallback.jsonl            # JSONL fallback for audit/notification failures
└── .logs/
    ├── backupctl-2026-03-18.log  # Winston daily rotate
    └── backupctl-2026-03-17.log
```

Each project gets its own subdirectory. The `.lock` file is present only while a backup is in progress and is removed on completion (or cleaned by startup recovery if the process crashed). The `.fallback-audit/` directory holds JSONL entries that are replayed into the audit database on the next successful startup.

## Validation

Use the CLI to validate configuration at any time:

```bash
# Validate YAML structure, required fields, and .env variable resolution
backupctl config validate

# Show resolved config for a specific project (secrets masked)
backupctl config show locaboo
```

`config validate` checks:

- YAML syntax and structure
- Required fields present for each project
- `${VAR_NAME}` references resolve to non-empty values in `.env`
- Database type is one of `postgres`, `mysql`, `mongodb`
- Notification type is one of `slack`, `email`, `webhook`
- Cron expressions are valid
- Retention values are non-negative
- GPG recipient is set when encryption is enabled

## What's Next

- **Run commands** — [CLI Reference](06-cli-reference.md) covers all 14 commands with flags and examples.
- **Understand the flow** — [Backup Flow](08-backup-flow.md) explains the 11-step orchestration pipeline.
- **Quick reference** — [Cheatsheet](10-cheatsheet.md) for daily operations.
