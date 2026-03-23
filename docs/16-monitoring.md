# Heartbeat Monitoring

backupctl supports **heartbeat monitoring** — a passive failure detection mechanism that complements the active notification system. After each backup, a heartbeat ping is sent to an external monitoring service. If the ping stops arriving (crashed container, stuck cron, hung process), the monitoring service detects the silence and fires its own alerts.

The architecture is generic: the `HeartbeatMonitorPort` defines the contract, and adapters implement it for specific services. Currently, [Uptime Kuma](https://github.com/louislam/uptime-kuma) push monitors are supported. Adding other services (Healthchecks.io, Betterstack, etc.) requires only a new adapter — no changes to the backup flow or configuration structure.

---

## How It Works

```
backupctl                          Monitoring Service
┌─────────────┐                   ┌─────────────┐
│ Backup runs │── success ──────→ │ status=up   │ → Dashboard green
│             │                   │             │
│ Backup fails│── failure ──────→ │ status=down │ → Dashboard red, alert fires
│             │                   │             │
│ No backup   │── (no ping) ───→ │ timeout     │ → Dashboard red, alert fires
│ (crash/hang)│                   │             │
└─────────────┘                   └─────────────┘
```

- **Success**: sends `status=up` with backup duration
- **Failure**: sends `status=down` immediately — no waiting for timeout
- **Silent failure**: no ping arrives, the monitoring service detects the missing heartbeat after the configured interval

This is separate from backupctl's notification system (Slack, Email, Webhook). The two complement each other:

| System | When it fires | Use case |
|--------|--------------|----------|
| backupctl notifications | On every backup event | Detailed backup results, errors, duration |
| Heartbeat monitoring | When heartbeat is missing or DOWN | Silent failure detection (dead container, stuck cron) |

---

## Configuration

### Environment Variables

Add to your `.env`:

```env
UPTIME_KUMA_BASE_URL=https://kuma.example.com
```

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `UPTIME_KUMA_BASE_URL` | Only if any project uses `monitor.type: uptime-kuma` | — | Base URL of your Uptime Kuma instance |

### Project YAML

Add a `monitor` block to any project in `config/projects.yml`:

```yaml
projects:
  - name: vinsware
    cron: '0 0 * * *'
    # ... existing config ...
    monitor:
      type: uptime-kuma
      config:
        push_token: YOUR_PUSH_TOKEN
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `monitor.type` | string | yes | Monitor type (`uptime-kuma`) |
| `monitor.config.push_token` | string | yes | Push token from the monitoring service |

The `monitor` block is optional and independent of `notification`. Projects without it skip the heartbeat step entirely.

### Validation

`backupctl config validate` checks:

- If `monitor.type` is `uptime-kuma`, `UPTIME_KUMA_BASE_URL` must be set in `.env`
- If `monitor.type` is `uptime-kuma`, `config.push_token` must be present

---

## Uptime Kuma Setup

backupctl does **not** bundle or manage Uptime Kuma. You run Kuma on your own infrastructure — a dedicated server, a separate Docker host, or any other setup. backupctl only needs the base URL and a push token per project.

### Create Push Monitors

For each project you want to monitor:

1. Open your Uptime Kuma dashboard
2. Click **Add New Monitor**
3. Set **Monitor Type** to **Push**
4. Set **Friendly Name** (e.g., `vinsware-backup`)
5. Set **Heartbeat Interval** to match your backup schedule (see [Recommended Intervals](#recommended-intervals))
6. Set **Retries** to `0` (backupctl sends `status=down` on failure — no need for Kuma to retry)
7. Click **Save**
8. Copy the **Push Token** — the last segment of the push URL (e.g., if the URL is `https://kuma.example.com/api/push/abcd1234`, the token is `abcd1234`)

### Recommended Intervals

Set the heartbeat interval to match your project's cron schedule plus a grace period for backup duration variability.

| Cron Schedule | Description | Heartbeat Interval | Grace Period |
|---------------|-------------|--------------------|-----------------------|
| `0 0 * * *` | Daily at midnight | 86400s (24h) | 3600s (1h) |
| `0 */6 * * *` | Every 6 hours | 21600s (6h) | 1800s (30m) |
| `0 */12 * * *` | Every 12 hours | 43200s (12h) | 3600s (1h) |
| `30 1 * * *` | Daily at 01:30 | 86400s (24h) | 3600s (1h) |

**Why Retries = 0?** backupctl actively sends `status=down` on backup failure, so Kuma doesn't need to wait and retry — the failure is reported immediately.

### Kuma Notifications

Configure Kuma's own notification channels (Slack, Email, Telegram, Discord, etc.) in its web UI under **Settings → Notifications**. These fire when a push monitor goes DOWN — either from an explicit `status=down` ping or from a missing heartbeat.

---

## Heartbeat Details

### On Success

```
GET /api/push/{token}?status=up&msg=OK - 3m 12s&ping=192000
```

- `status=up` — monitor shows green
- `msg` — human-readable duration (truncated to 200 chars)
- `ping` — raw duration in milliseconds

### On Failure

```
GET /api/push/{token}?status=down&msg=FAIL - sync: connection timeout&ping=342000
```

- `status=down` — monitor shows red immediately
- `msg` — failure stage and error (truncated to 200 chars)
- `ping` — time until failure in milliseconds

### Placement in Backup Flow

The heartbeat is the last step before lock release:

```
 0.  Lock acquire
 0b. Audit startRun
 1.  Notify started
 2.  Pre-hook
 3.  Dump
 4.  Verify
 5.  Encrypt
 6.  Sync
 7.  Prune
 8.  Cleanup
 9.  Post-hook
10.  Audit finishRun
11.  Notify success/failure
12.  Heartbeat ping          ← HERE
13.  Lock release
```

### Failure Behavior

- Heartbeat failure is **logged but never affects backup status** or exit code
- No fallback writer for heartbeat — if the monitoring service is down, the missed heartbeat itself is the detection signal
- Dry runs (`--dry-run`) skip the heartbeat entirely
- `run --all` sends a separate heartbeat per project

---

## Health Check

When `UPTIME_KUMA_BASE_URL` is configured, the `health` command verifies connectivity:

```bash
backupctl health
```

```
System healthy

  ✓ Audit DB
  ✓ Disk space (42 GB free)
  ✓ SSH connection
  ✓ SSH auth
  ✓ Restic repos
  ✓ Uptime Kuma
  Uptime: 2h 15m
```

The HTTP health endpoint also includes Kuma status when configured.

---

## Testing

1. **Validate config**: `backupctl config validate`
2. **Check connectivity**: `backupctl health` — confirms backupctl can reach your Kuma instance
3. **Run a real backup**: `backupctl run <project>` — `--dry-run` skips heartbeat, so use a real run
4. **Check Kuma dashboard**: the push monitor should turn green with the backup duration shown
5. **Test failure path**: temporarily break something (e.g., wrong `database.host`), run again — the monitor should turn red immediately

---

## Troubleshooting

### Monitor Shows No Heartbeat

1. Check `UPTIME_KUMA_BASE_URL` is set in `.env` and the URL is reachable from the backupctl container
2. Run `backupctl health` to verify connectivity
3. Verify the push token matches what's in Kuma
4. Check logs: `docker logs backupctl 2>&1 | grep -i heartbeat`

### Monitor Shows DOWN But Backup Succeeded

1. The heartbeat interval in Kuma may be too short for your backup duration — increase the grace period
2. Check if `UPTIME_KUMA_BASE_URL` resolves from within the backupctl container (DNS, firewall, network)

### Network Connectivity

If backupctl runs in Docker and Kuma is on a separate host, ensure the backupctl container can reach Kuma's URL. This may require:

- Exposing Kuma on a routable address (not `localhost`)
- Configuring Docker network settings or `extra_hosts`
- Opening firewall rules for the Kuma port

---

## What's Next

- **Configure notifications** — [Configuration](05-configuration.md) covers Slack, Email, and Webhook notification setup
- **Understand the backup flow** — [Backup Flow](08-backup-flow.md) explains the full orchestration pipeline
- **Add more adapters** — [Adding Adapters](11-adding-adapters.md) covers extending backupctl with new database engines, notifiers, or monitoring backends
