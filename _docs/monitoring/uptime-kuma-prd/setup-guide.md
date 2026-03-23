# Uptime Kuma Setup Guide

Deploy Uptime Kuma on a dedicated monitoring server with Nginx reverse proxy and Let's Encrypt SSL.

---

## Prerequisites

- A Linux server (e.g., Ubuntu 22.04+) with root/sudo access
- Docker installed and running
- Nginx installed and serving at least one site
- Certbot installed with the Nginx plugin (`certbot --nginx`)
- A DNS A record pointing `status.example.com` to the server's IP

---

## 1. Deploy the Kuma Container

```bash
docker run -d \
  --name uptime-kuma \
  --restart unless-stopped \
  -p 127.0.0.1:3001:3001 \
  -v uptime-kuma-data:/app/data \
  louislam/uptime-kuma:1
```

Key choices:

- **`127.0.0.1:3001`** -- binds to localhost only; Nginx handles public traffic
- **Named volume** (`uptime-kuma-data`) -- persists Kuma's SQLite database across restarts
- **`unless-stopped`** -- auto-restarts after reboot unless explicitly stopped
- **`:1` tag** -- tracks the latest v1.x release (major-version pinning)

Verify the container is running:

```bash
docker ps --filter name=uptime-kuma
curl -s http://127.0.0.1:3001 | head -5
```

---

## 2. Configure Nginx Reverse Proxy

Create `/etc/nginx/sites-available/status.example.com`:

```nginx
server {
    listen 80;
    server_name status.example.com;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;

        # WebSocket support (required for Kuma's real-time dashboard)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable the site and reload Nginx:

```bash
ln -s /etc/nginx/sites-available/status.example.com /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

At this point, `http://status.example.com` should show the Kuma login/setup page.

---

## 3. Enable SSL with Certbot

```bash
certbot --nginx -d status.example.com
```

Certbot will modify the Nginx config to add SSL directives and set up auto-renewal. This is safe alongside existing certificates on the same server -- Certbot manages each domain independently.

Verify HTTPS:

```bash
curl -I https://status.example.com
```

---

## 4. First-Time Kuma Setup

1. Open `https://status.example.com` in a browser
2. Create an admin account (username + password)
3. **Configure notification channels** under Settings > Notifications:
   - Slack (webhook URL)
   - Email (SMTP)
   - Telegram, Discord, etc.
4. These notification channels are used by Kuma itself to alert when monitors go DOWN

---

## 5. Create Push Monitors for backupctl

For each backup project that should report heartbeats:

1. In Kuma UI, click **Add New Monitor**
2. Set **Monitor Type** to **Push**
3. Set a descriptive **Friendly Name** (e.g., `vinsware-backup`)
4. Set **Heartbeat Interval** to match the project's cron schedule:

   | Cron Schedule | Description | Interval | Grace Period |
   |---------------|-------------|----------|--------------|
   | `0 0 * * *`   | Daily       | 86400s   | 3600s        |
   | `0 */6 * * *` | Every 6h    | 21600s   | 1800s        |
   | `0 */12 * * *`| Every 12h   | 43200s   | 3600s        |

5. Set **Retries** to `0` -- backupctl explicitly sends `status=down` on failure, so Kuma doesn't need to retry
6. Click **Save** and copy the **Push Token** from the monitor page

---

## 6. Understanding Heartbeat Timing

Uptime Kuma push monitors work as a **dead man's switch**. Kuma starts a countdown timer every time it receives a heartbeat. If the timer expires without a new heartbeat, Kuma assumes the backup process is dead and marks the monitor as DOWN.

### Three scenarios

**Backup succeeds** — heartbeat arrives immediately after completion:

```
Day 1, 02:00  →  Cron triggers backup
Day 1, 02:05  →  Backup finishes (5 min)
                  → sends status=up immediately
                  → Kuma: UP ✓ (within seconds)
                  → Kuma resets its 25h countdown

Day 2, 02:00  →  Cron triggers backup
Day 2, 02:07  →  Backup finishes (7 min)
                  → sends status=up immediately
                  → Kuma: UP ✓ (within seconds)
                  → Kuma resets its 25h countdown
```

Kuma shows UP **the moment it receives the heartbeat**, not after the interval elapses. The heartbeat arrives right when the backup finishes — typically minutes after the cron fires.

**Backup fails** — heartbeat arrives immediately with `status=down`:

```
Day 1, 02:00  →  Cron triggers backup
Day 1, 02:02  →  Dump fails (disk full)
                  → sends status=down immediately
                  → Kuma: DOWN ✗ (within seconds)
                  → Kuma sends alert via its notification channels
```

Because **Retries = 0**, a single `status=down` heartbeat triggers the alert immediately.

**Backup never runs** — no heartbeat at all (container crashed, cron misconfigured):

```
Day 1, 02:05  →  Last successful heartbeat → Kuma: UP ✓
                  → 25h countdown starts

Day 2          →  Container is down, cron never fires, nothing sent

Day 2, 03:05  →  25h elapsed with no heartbeat
                  → Kuma: DOWN ✗ (timeout)
                  → Kuma sends alert
```

This is the scenario the heartbeat interval protects against — complete silence from the backup process.

### Calculating the interval

```
Heartbeat Interval = cron interval + max expected backup duration + buffer
```

| Cron | Interval | Max backup | Buffer | Heartbeat Interval |
|------|----------|------------|--------|--------------------|
| Daily (24h) | 86400s | ~30 min | ~30 min | **90000s** (25h) |
| Every 12h | 43200s | ~30 min | ~30 min | **46800s** (13h) |
| Every 6h | 21600s | ~15 min | ~15 min | **23400s** (6.5h) |

**Too short** → false alarms between scheduled runs (Kuma expires before the next backup is even scheduled).

**Too long** → delayed detection of missed runs (if backup never runs, you won't know for a long time).

### Why Retries must be 0

backupctl explicitly sends `status=down` on failure. If Kuma's Retries > 0, Kuma would **ignore** the first `down` heartbeat and wait for more pings before alerting. With Retries = 0:

- `status=up` → immediate UP
- `status=down` → immediate DOWN + alert
- Silence → timeout after interval → DOWN + alert

### The `ping` parameter

The heartbeat URL includes `?ping={durationMs}` (e.g., `?ping=192000` for a 3m 12s backup). This is **display-only metadata** — Kuma shows it as "response time" in its dashboard graphs. It does not affect the heartbeat interval or timeout logic.

---

## 7. Configure backupctl

### 7.1 Set the base URL in `.env`

```env
UPTIME_KUMA_BASE_URL=https://status.example.com
```

### 7.2 Add monitor config to `projects.yml`

For each project, add a `monitor` block with the push token from step 5:

```yaml
projects:
  - name: vinsware
    enabled: true
    cron: '0 0 * * *'
    # ... existing database, assets, restic, notification config ...
    monitor:
      type: uptime-kuma
      config:
        push_token: abc123def456
```

Projects without a `monitor` block simply skip the heartbeat step.

### 7.3 Validate

```bash
backupctl config validate
```

This verifies that `UPTIME_KUMA_BASE_URL` is set when any project has a `monitor` block, and that each monitor config has a `push_token`.

---

## 8. Verify End-to-End

Trigger a backup and confirm the heartbeat reaches Kuma:

```bash
backupctl run vinsware
```

In the Kuma dashboard, the `vinsware-backup` monitor should show a green UP status with the backup duration displayed as response time.

To test failure detection, stop sending heartbeats (or run a backup that fails). After the configured interval + grace period, Kuma will mark the monitor as DOWN and send alerts through its notification channels.

---

## 9. Maintenance

### Update Kuma

```bash
docker pull louislam/uptime-kuma:1
docker stop uptime-kuma
docker rm uptime-kuma
docker run -d \
  --name uptime-kuma \
  --restart unless-stopped \
  -p 127.0.0.1:3001:3001 \
  -v uptime-kuma-data:/app/data \
  louislam/uptime-kuma:1
```

The named volume preserves all data (monitors, history, settings) across container recreation.

### Backup Kuma Data

The SQLite database lives in the `uptime-kuma-data` Docker volume. To back it up:

```bash
docker run --rm \
  -v uptime-kuma-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/uptime-kuma-backup.tar.gz -C /data .
```

### Logs

```bash
docker logs uptime-kuma --tail 100
docker logs uptime-kuma -f
```
