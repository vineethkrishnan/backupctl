# PRD: Uptime Kuma Heartbeat Monitoring for backupctl

**Version:** 1.0
**Date:** March 23, 2026
**Author:** Vineeth N K
**Status:** Final

---

## 1. Problem Statement

backupctl currently notifies about backup events via Slack, Email, or Webhook. These are **active** notifications — they fire when something happens. But if the backup process itself dies silently (container crash, cron not firing, process hang, Docker restart loop), **no notification is sent** because there is no running code to send one.

This creates a blind spot: the absence of a backup going undetected until someone manually checks.

**Uptime Kuma push monitors** solve this with a "dead man's switch" pattern. After each backup, backupctl pings Uptime Kuma. If the ping doesn't arrive within the expected interval, Uptime Kuma marks the project as DOWN and alerts via its own notification channels. This gives **passive failure detection** — detecting when nothing happens at all.

---

## 2. Goals

- Add a single, shared Uptime Kuma instance as a Docker container alongside backupctl
- Introduce a per-project `monitor` config section (separate from `notification`) following the existing adapter pattern
- Send heartbeat pings to Uptime Kuma after each backup completes (success → `status=up`, failure → `status=down`)
- Keep the existing notification system (Slack/Email/Webhook) completely unchanged
- Make monitoring optional — projects without a `monitor` block simply don't send heartbeats

---

## 3. Non-Goals

- Replacing or modifying the existing notification system
- Using Uptime Kuma for anything other than push monitors (no HTTP polling, TCP checks, etc. from backupctl's side — users can add those manually in the Kuma UI)
- Auto-provisioning push monitors in Uptime Kuma via API (users create monitors manually in the Kuma UI and copy the push token into YAML)
- Multi-instance Uptime Kuma (one shared instance for all projects and services)
- Heartbeat for individual backup stages (one heartbeat per completed backup run, not per stage)

---

## 4. User Scenarios

### Persona: DevOps Engineer / Self-Hoster

#### Scenario 1: Initial Setup — Deploy Uptime Kuma alongside backupctl

**Who:** DevOps engineer setting up monitoring for the first time.

**What:** Deploy a single Uptime Kuma container that runs alongside backupctl and the audit DB. Access the Kuma web UI to create push monitors for each project.

**Steps:**
1. Add Uptime Kuma env vars to `.env` (`UPTIME_KUMA_BASE_URL`)
2. Run `docker compose up -d` — Kuma container starts alongside existing containers
3. Access Kuma UI at the configured port (default `3001`)
4. Complete Kuma's first-time setup (create admin account)
5. Create a Push Monitor for each backup project (e.g., "vinsware-backup"), set heartbeat interval to match the project's cron schedule + grace period
6. Copy the push token from each monitor into `projects.yml` under `monitor.config.push_token`
7. Run `backupctl config validate` to verify the monitor config is valid

**Functional Requirements:**
- FR-1.1: `docker-compose.yml` includes an `uptime-kuma` service definition with persistent volume for Kuma's SQLite DB
- FR-1.2: Kuma container joins the `backupctl-network` so backupctl can reach it
- FR-1.3: Kuma UI port is configurable via `UPTIME_KUMA_PORT` env var (default `3001`)
- FR-1.4: `UPTIME_KUMA_BASE_URL` env var defines the base URL used by backupctl to construct push URLs (e.g., `http://uptime-kuma:3001`)
- FR-1.5: Config validation reports an error if a project has `monitor` config but `UPTIME_KUMA_BASE_URL` is not set

**Acceptance Criteria:**
- AC-1.1: After `docker compose up -d`, Kuma UI is accessible at `http://<host>:<UPTIME_KUMA_PORT>`
- AC-1.2: Kuma data persists across container restarts (SQLite stored on named volume)
- AC-1.3: `backupctl config validate` succeeds when `UPTIME_KUMA_BASE_URL` is set and push tokens are configured
- AC-1.4: `backupctl config validate` fails with a clear error when a project has `monitor` but `UPTIME_KUMA_BASE_URL` is missing

**Dependencies:** Docker, Docker Compose

**Assumptions:**
- Users create push monitors manually via Kuma UI — no API automation
- The heartbeat interval and grace period in Kuma are configured by the user to match the project's backup schedule (e.g., for a daily backup at midnight, set interval to 86400s with a 3600s grace period)

---

#### Scenario 2: Successful Backup — Heartbeat Ping Sent

**Who:** Automated backup (cron or CLI-triggered).

**What:** After a backup completes successfully, backupctl sends an `up` heartbeat to Uptime Kuma for that project. The Kuma dashboard shows the project as UP with a green indicator.

**Steps:**
1. Backup runs through the normal 11-step flow
2. After audit finalization (step 10) and notification (step 11), send heartbeat ping
3. Construct push URL: `{UPTIME_KUMA_BASE_URL}/api/push/{push_token}?status=up&msg={short_message}&ping={duration_ms}`
4. Send HTTP GET request to the push URL
5. Kuma records the heartbeat — dashboard shows UP

**Functional Requirements:**
- FR-2.1: A new `HeartbeatMonitorPort` interface defines the outbound contract: `sendHeartbeat(projectName, status, message, durationMs)`
- FR-2.2: `UptimeKumaHeartbeatAdapter` implements `HeartbeatMonitorPort` using HTTP GET to Kuma's push API
- FR-2.3: Push URL format: `{UPTIME_KUMA_BASE_URL}/api/push/{push_token}?status=up&msg={msg}&ping={ping}`
- FR-2.4: On success, `msg` contains a short summary: `"OK - {duration}"` (e.g., `"OK - 3m 12s"`)
- FR-2.5: `ping` parameter contains the backup duration in milliseconds (Kuma displays this as response time)
- FR-2.6: Heartbeat is sent **after** audit and notification finalization — it is the last step in the backup flow
- FR-2.7: Heartbeat failure must NOT mark the backup as failed — log the error and continue (same pattern as notification failure)

**Acceptance Criteria:**
- AC-2.1: After a successful backup for a project with `monitor` config, an HTTP GET is sent to the correct Kuma push URL with `status=up`
- AC-2.2: The `msg` parameter contains the backup duration in human-readable format
- AC-2.3: The `ping` parameter contains the raw duration in milliseconds
- AC-2.4: If the heartbeat HTTP call fails (Kuma down, network error), the backup result remains `success` and the error is logged
- AC-2.5: Projects without `monitor` config skip the heartbeat step entirely

**Dependencies:** Uptime Kuma container running, `UPTIME_KUMA_BASE_URL` configured

**Assumptions:** Kuma is reachable from the backupctl container via Docker network

---

#### Scenario 3: Failed Backup — Immediate DOWN Signal

**Who:** Automated backup that encounters a failure.

**What:** After a backup fails, backupctl sends a `down` heartbeat to Uptime Kuma. The Kuma dashboard immediately shows the project as DOWN with a red indicator, triggering Kuma's own alert notifications.

**Steps:**
1. Backup fails at any stage
2. After audit finalization and failure notification, send heartbeat ping
3. Construct push URL with `status=down` and error details in `msg`
4. Send HTTP GET request
5. Kuma records the failure — dashboard shows DOWN immediately

**Functional Requirements:**
- FR-3.1: On backup failure, send heartbeat with `status=down`
- FR-3.2: `msg` contains a short failure summary: `"FAIL - {stage}: {error_message}"` (truncated to 200 chars to stay within URL length limits)
- FR-3.3: `ping` parameter contains the backup duration in milliseconds (time until failure)
- FR-3.4: The DOWN status is sent immediately — the user does not have to wait for the heartbeat timeout to detect a failure

**Acceptance Criteria:**
- AC-3.1: After a failed backup, an HTTP GET is sent with `status=down`
- AC-3.2: The `msg` includes the failure stage and error message
- AC-3.3: Kuma dashboard shows the project as DOWN within seconds of the backup failure
- AC-3.4: If heartbeat call fails, the backup failure is already recorded in audit and notification — no data is lost

**Dependencies:** Same as Scenario 2

**Assumptions:** Kuma notifications (email, Slack, etc.) are configured by the user within Kuma's own UI — backupctl does not manage Kuma's notification settings

---

#### Scenario 4: Silent Failure — No Backup Runs At All

**Who:** The system — backupctl container crashed, cron didn't fire, Docker restart loop.

**What:** No backup runs, so no heartbeat is sent. After the configured heartbeat interval + grace period expires, Uptime Kuma automatically marks the project as DOWN and triggers its own alert.

**Functional Requirements:**
- FR-4.1: This scenario requires NO code changes — it is handled entirely by Uptime Kuma's built-in push monitor timeout logic
- FR-4.2: Documentation must explain how to set the heartbeat interval in Kuma to match the project's cron schedule (e.g., daily backup → 86400s interval, 3600s grace)

**Acceptance Criteria:**
- AC-4.1: If no heartbeat arrives within the configured interval + grace period, Kuma shows the project as DOWN
- AC-4.2: Documentation includes recommended interval/grace settings for common cron schedules

**Dependencies:** Kuma push monitors created with correct interval settings

**Assumptions:** The user configures reasonable intervals in Kuma (documented as guidance, not enforced)

---

#### Scenario 5: Dry Run — No Heartbeat Sent

**Who:** DevOps engineer running `backupctl run <project> --dry-run`.

**What:** Dry runs simulate the backup without executing destructive steps. Heartbeat should NOT be sent during dry runs — it would give Kuma a false "UP" signal.

**Functional Requirements:**
- FR-5.1: Dry run mode skips the heartbeat step entirely
- FR-5.2: No HTTP call is made to Kuma during dry runs

**Acceptance Criteria:**
- AC-5.1: Running `backupctl run vinsware --dry-run` with monitor config does NOT send a heartbeat to Kuma
- AC-5.2: Kuma's heartbeat timer is unaffected by dry runs

**Dependencies:** None

**Assumptions:** None

---

#### Scenario 6: Health Check — Kuma Connectivity

**Who:** DevOps engineer running `backupctl health`.

**What:** The health check verifies that Uptime Kuma is reachable from the backupctl container, in addition to existing checks (audit DB, restic, disk, SSH).

**Functional Requirements:**
- FR-6.1: If `UPTIME_KUMA_BASE_URL` is configured, the health check pings Kuma's status page or API to verify connectivity
- FR-6.2: Health check reports Kuma status as a separate line item: `Uptime Kuma: OK` or `Uptime Kuma: UNREACHABLE`
- FR-6.3: If `UPTIME_KUMA_BASE_URL` is not configured, the Kuma health check is skipped (not reported as a failure)

**Acceptance Criteria:**
- AC-6.1: `backupctl health` output includes an Uptime Kuma connectivity check when configured
- AC-6.2: If Kuma is unreachable, health check reports the specific error (connection refused, timeout, etc.)
- AC-6.3: Health check still passes for projects without monitor config

**Dependencies:** Uptime Kuma container running

**Assumptions:** A simple HTTP GET to Kuma's base URL is sufficient to verify connectivity

---

## 5. Configuration

### 5.1 Global `.env` (new variables)

```env
# Uptime Kuma (optional — only needed if using monitor feature)
UPTIME_KUMA_BASE_URL=http://uptime-kuma:3001
UPTIME_KUMA_PORT=3001
```

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `UPTIME_KUMA_BASE_URL` | Only if any project has `monitor` config | — | Base URL for Kuma push API (internal Docker hostname) |
| `UPTIME_KUMA_PORT` | No | `3001` | Port exposed on host for Kuma web UI |

### 5.2 Project YAML — `monitor` block

```yaml
projects:
  - name: vinsware
    enabled: true
    cron: '0 0 * * *'
    # ... existing config ...
    notification:
      type: slack
      config:
        webhook_url: https://hooks.slack.com/services/VINSWARE/SPECIFIC/HOOK
    monitor:
      type: uptime-kuma
      config:
        push_token: abc123def456

  - name: project-x
    enabled: true
    cron: '30 1 * * *'
    # ... existing config ...
    notification:
      type: email
      config:
        # ... email config ...
    monitor:
      type: uptime-kuma
      config:
        push_token: xyz789ghi012

  - name: project-y
    enabled: true
    cron: '0 2 * * *'
    # ... existing config ...
    # No monitor block — heartbeat skipped for this project
```

### 5.3 Config Resolution Rules (additions to existing rules)

1. `monitor` block is optional — projects without it skip heartbeat entirely
2. If `monitor.type` is `uptime-kuma`, `UPTIME_KUMA_BASE_URL` must be set in `.env`
3. `push_token` is required when `monitor.type` is `uptime-kuma`
4. Push URL is constructed as: `{UPTIME_KUMA_BASE_URL}/api/push/{push_token}`
5. No global fallback for `monitor` (unlike `notification`) — monitoring must be explicitly configured per project

---

## 6. Docker Compose Changes

### New service: `uptime-kuma`

```yaml
uptime-kuma:
  container_name: uptime-kuma
  image: louislam/uptime-kuma:1
  volumes:
    - uptime-kuma-data:/app/data
  ports:
    - '${UPTIME_KUMA_PORT:-3001}:3001'
  networks:
    - backupctl-network
  restart: unless-stopped
  deploy:
    resources:
      limits:
        memory: 512M
        cpus: '1'
```

### New volume

```yaml
volumes:
  backupctl-audit-data:
  uptime-kuma-data:       # NEW — persists Kuma's SQLite DB
```

### No dependency from backupctl

The `backupctl` service does NOT `depends_on` uptime-kuma. Kuma being down should never prevent backupctl from starting or running backups. The heartbeat call simply fails silently (logged, not fatal).

---

## 7. Backup Flow Integration

The heartbeat sits **after** the existing flow — it's the very last step:

```
Existing flow (unchanged):
 0.  BackupLockPort.acquire()
 0b. AuditLogPort.startRun()
 1.  NotifierPort.notifyStarted()
 2.  HookExecutorPort.execute(preBackup)
 3.  DatabaseDumperPort.dump()
 4.  DatabaseDumperPort.verify()
 5.  DumpEncryptorPort.encrypt()
 6.  RemoteStoragePort.sync()
 7.  RemoteStoragePort.prune()
 8.  LocalCleanupPort.cleanup()
 9.  HookExecutorPort.execute(postBackup)
10.  AuditLogPort.finishRun()
11.  NotifierPort.notifySuccess/Failure()

New step:
12.  HeartbeatMonitorPort.sendHeartbeat()  ← NEW (success=up, failure=down)

13.  BackupLockPort.release()
```

**Key behavior:**
- Heartbeat is sent regardless of backup outcome (success → `up`, failure → `down`)
- Heartbeat failure is logged but does NOT affect backup status or exit code
- Dry runs skip the heartbeat step
- `run --all` sends a heartbeat per project (after each individual backup, not once at the end)

---

## 8. Out of Scope

- Uptime Kuma notification configuration (users set up Kuma alerts in Kuma's own UI)
- Auto-provisioning push monitors via Kuma API
- Monitoring non-backup services through backupctl (users can add HTTP/TCP monitors directly in Kuma UI)
- Global fallback for `monitor` config (each project must explicitly opt in)
- Heartbeat for `backupctl prune`, `backupctl restore`, or other non-backup commands
- Support for other push monitor services (e.g., Healthchecks.io, Cronitor) — the adapter pattern makes this easy to add later via a new `type`
- Daily summary heartbeat (heartbeat is per backup run, not per summary)

---

## 9. Documentation Requirements

| Document | Content |
|----------|---------|
| `docs/monitoring.md` (new) | Uptime Kuma setup guide: container, first-time UI setup, creating push monitors, recommended intervals per cron schedule, YAML config examples |
| `docs/05-configuration.md` (update) | Add `monitor` block reference, `UPTIME_KUMA_BASE_URL`, `UPTIME_KUMA_PORT` env vars |
| `.env.example` (update) | Add `UPTIME_KUMA_BASE_URL` and `UPTIME_KUMA_PORT` (commented out) |
| `config/projects-example.yml` (update) | Add `monitor` block examples to existing projects |
| `README.md` (update) | Mention Uptime Kuma in architecture overview |

---

## 10. Recommended Kuma Intervals

Guidance for users (to be included in documentation):

| Cron Schedule | Description | Heartbeat Interval | Retries | Recommended Grace |
|---------------|-------------|--------------------|---------|--------------------|
| `0 0 * * *` | Daily at midnight | 86400s (24h) | 0 | 3600s (1h) |
| `0 */6 * * *` | Every 6 hours | 21600s (6h) | 0 | 1800s (30m) |
| `0 */12 * * *` | Every 12 hours | 43200s (12h) | 0 | 3600s (1h) |
| `30 1 * * *` | Daily at 01:30 | 86400s (24h) | 0 | 3600s (1h) |

**Why retries = 0:** backupctl already sends `status=down` on failure, so Kuma doesn't need to retry — the failure is explicitly reported. Setting retries to 0 ensures instant DOWN visibility.

---

## 11. Risks and Assumptions

### Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Kuma container crashes | Heartbeats not recorded, but backups still run normally | `restart: unless-stopped` + Kuma has its own Docker health check |
| Push token leaks in YAML | Attacker could send false heartbeats | Push tokens are non-sensitive (they can't access data), but YAML should still be protected with proper file permissions |
| Kuma SQLite corruption | Monitoring history lost | Volume-backed data, Kuma handles its own SQLite resilience |

### Assumptions

- Uptime Kuma's push API (`/api/push/{token}`) remains stable across Kuma versions (using `louislam/uptime-kuma:1` tag for major version pinning)
- Users will configure Kuma's own notification channels (email, Slack, Telegram, etc.) through Kuma's web UI
- The backupctl container can reach `uptime-kuma:3001` via Docker network
- Push tokens are short, URL-safe strings generated by Kuma
