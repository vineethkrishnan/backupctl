# pg_dump / mysqldump Times Out on Large Databases

> **TL;DR** — If scheduled backups for a database larger than ~2 GB fail with `Command "pg_dump" failed` after roughly 5 minutes, you're on a backupctl build older than **v0.1.22**. The dump timeout was raised from 5 min → 30 min in v0.1.22. Short-term, patch the compiled file and restart the container. Long-term, run `backupctl-manage.sh upgrade`.

## Symptom

Your scheduled cron backup fails every day around the same time with an error like:

```
Command "pg_dump" failed: Command failed: pg_dump --host postgres --port 5432 \
  --username psql-user --dbname project \
  --format=custom --file /data/backups/project-x/project-x_backup_20260418_040000.dump
```

![pg_dump timeout error in the audit log](/images/helpcenter/01-pg-dump-timeout-error.png)

The error appears **exactly** ~5 minutes after the backup started. Running `backupctl run <project>` manually from a shell usually succeeds (because the process is fresh and fast enough, or because you've already applied the hotfix below).

## Who this affects

- backupctl **v0.1.21 or earlier**
- Any project with a database dump that realistically takes longer than 5 minutes — typically > 2 GB on Postgres, earlier for MySQL over slow networks
- Both scheduled (cron) and manual runs — but scheduled runs fail first because they run against the long-lived NestJS process which has the old timeout cached

## Root cause

The dump is run through `safeExecFile()` in `src/common/helpers/child-process.util.ts`. Before v0.1.22, the default timeout was **300 000 ms (5 min)**:

```ts
// Before v0.1.22
const { timeout = 300000, env, cwd } = options;
```

Node's `child_process.execFile` kills the child when the timeout expires — so `pg_dump` gets SIGTERM mid-dump and backupctl surfaces a generic `Command "pg_dump" failed`. There's no visible "timeout" wording in the error, which is why this is easy to misdiagnose as a DB / network issue.

In v0.1.22 the default was raised to **1 800 000 ms (30 min)**.

## Diagnose

Confirm you've hit this specific issue and not, say, a DB credentials or disk problem.

### 1. Check the installed backupctl version

```bash
docker exec backupctl cat /app/package.json | grep '"version"'
```

If you see `0.1.21` or lower, you are affected.

![package.json version check](/images/helpcenter/01-version-check.png)

### 2. Confirm the timeout in the compiled file

```bash
docker exec backupctl grep -n 'timeout = ' /app/dist/common/helpers/child-process.util.js
```

Expected output on an affected build:

```
19:  const { timeout = 300000, env, cwd } = options;
```

### 3. Correlate failure time with the 5-minute window

```bash
backupctl logs <project> --last 3 --failed
```

If every failure shows `duration_ms` close to `300000` (±a few seconds), the timeout is firing, not the database.

### 4. Rule out other causes

Before applying the workaround, confirm the database itself is healthy — the point of this article is that the DB is fine and we're being killed by our own default:

```bash
# DB reachable from the container?
docker exec backupctl pg_isready -h <db-host> -p 5432

# Disk has space for the dump?
docker exec backupctl df -h /data/backups

# Manual dump from inside the container completes?
docker exec backupctl pg_dump \
  --host <db-host> --port 5432 \
  --username <user> --dbname <db> \
  --format=custom --file /tmp/sanity.dump
```

If all three succeed and you're on ≤ v0.1.21, you've confirmed the issue.

## Short-term workaround

Use this **only** if you can't upgrade immediately (e.g., change freeze, waiting on a PR review). It patches the compiled JS in place.

```bash
# Raise the timeout from 5 min → 30 min in the running container
docker exec -i backupctl sed -i \
  's/timeout = 300000/timeout = 1800000/' \
  /app/dist/common/helpers/child-process.util.js

# Restart the container to drop Node's require() cache
docker compose restart backupctl
```

![sed hotfix applied and container restarted](/images/helpcenter/01-sed-hotfix.png)

> **Why the restart matters.** The long-running NestJS process caches JavaScript modules in memory via Node's `require()` cache. `sed` only rewrites the file on disk — without a restart, the running process keeps using the old value and the next scheduled run will fail exactly the same way. Manual `backupctl run` from a shell spawns a fresh Node process so it picks up the patched file, which is why manual runs appear to "work" while cron still fails. **Always restart the container after the sed command.**

Verify the patch:

```bash
docker exec backupctl grep 'timeout = ' /app/dist/common/helpers/child-process.util.js
# → const { timeout = 1800000, env, cwd } = options;
```

The patch survives container restarts but **not** `docker compose up --build` or `backupctl-manage.sh upgrade` — any rebuild replaces the file. That's intentional: the permanent fix is the upgrade.

## Permanent fix

Upgrade to v0.1.22 or later:

```bash
cd /path/to/backupctl
./scripts/backupctl-manage.sh upgrade
```

This pulls the latest code, rebuilds the image (with the 30-minute default baked in), runs migrations via the [migrator service](../14-migrations#production-migrations), and restarts the container. The sed hotfix is no longer needed after this.

![upgrade output showing new version active](/images/helpcenter/01-upgrade-complete.png)

Confirm:

```bash
docker exec backupctl cat /app/package.json | grep '"version"'
# → "version": "0.1.22",

docker exec backupctl grep 'timeout = ' /app/dist/common/helpers/child-process.util.js
# → const { timeout = 1800000, env, cwd } = options;
```

Run a manual backup end-to-end to prove the upgrade worked:

```bash
backupctl run <project>
backupctl status <project> --last 1
```

## Need longer than 30 minutes?

If your database legitimately takes longer than 30 minutes to dump (very large Postgres or MySQL instances), you have two options:

1. **Raise the per-project timeout warning** — adds a warning notification, but doesn't change the kill-timeout:

    ```yaml
    projects:
      - name: huge-db
        timeout_minutes: 90
    ```

    This only controls when `notifyWarning()` fires. See [Backup Timeout Warning](../12-troubleshooting#backup-timeout-warning).

2. **Raise the shell-exec default** — if 30 min is too short for the dump itself, open an issue; the default lives in `src/common/helpers/child-process.util.ts` and should be raised project-wide (or made configurable) rather than per-project.

## Prevent recurrence

- **Enable uptime-kuma heartbeat monitoring** — a scheduled backup that silently fails for days before someone notices is the main reason this bug stayed on production so long. See [Monitoring](../16-monitoring).
- **Set `NOTIFICATION_TYPE` globally** — even if the notification adapter fails, the audit DB + JSONL fallback will capture the failure. But you only *see* the failure day-of if a notifier is wired up.
- **Run `backupctl status --last 5` daily** — add to oncall's Monday checklist until a monitor is in place.

## Related

- [Backup Timeout Warning](../12-troubleshooting#backup-timeout-warning) — the project-level `timeout_minutes` (warning only, different from this hard kill-timeout)
- [Monitoring](../16-monitoring) — catch this class of failure passively
- [Upgrade](../06-cli-reference) — the `backupctl upgrade` CLI and how the upgrade check works
