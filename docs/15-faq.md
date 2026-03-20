# FAQ

Frequently asked questions grouped by topic. Each entry describes the symptom, explains why it happens, and provides step-by-step resolution.

---

## Table of Contents

### Setup

- [Port 3100 Already Allocated](#port-3100-already-allocated)
- [Restic Init Fails with SSH_FX_FAILURE](#restic-init-fails-with-ssh_fx_failure)
- [Restic Repository Does Not Exist](#restic-repository-does-not-exist)
- [Restic Fails with "Configuration key HETZNER_SSH_KEY_PATH does not exist"](#restic-fails-with-configuration-key-hetzner_ssh_key_path-does-not-exist)
- [Restic Hangs or Fails on Non-Standard SSH Port](#restic-hangs-or-fails-on-non-standard-ssh-port)
- [GPG Key Not Found During Dry Run](#gpg-key-not-found-during-dry-run)
- [.env Changes Not Taking Effect](#env-changes-not-taking-effect)
- [Dev and Prod Containers Conflict](#dev-and-prod-containers-conflict)
- [Dry Run Shows "No database dumper registered"](#dry-run-shows-no-database-dumper-registered)
- [Dry Run Shows "No notifier registered"](#dry-run-shows-no-notifier-registered)
- [SSH Warning About Post-Quantum Key Exchange](#ssh-warning-about-post-quantum-key-exchange)
- [First Backup Checklist](#first-backup-checklist)
- [pg_dump Version Mismatch](#pg_dump-version-mismatch-server-version-17x-pg_dump-version-9x)
- [GPG "Unusable public key" During Encrypt Stage](#gpg-unusable-public-key-during-encrypt-stage)
- [Docker Cannot Reach Hetzner Storage Box (Port 23 Blocked)](#docker-cannot-reach-hetzner-storage-box-port-23-blocked)
- [What is docker_network in projects.yml?](#what-is-docker_network-in-projectsyml)
- [How to Connect backupctl to Another Docker Compose Project's Database](#how-to-connect-backupctl-to-another-docker-compose-projects-database)

---

## Setup

### Port 3100 Already Allocated

**Symptom:**

```
Error response from daemon: Bind for 0.0.0.0:3100 failed: port is already allocated
```

**Why:** Another container or process is already using port 3100. This commonly happens when:
- The dev environment (`docker-compose.dev.yml`) is running and you try to start production (`docker-compose.yml`)
- A previous container didn't shut down cleanly

**Fix:**

1. Check what's using the port:

```bash
docker ps --format '{{.Names}}\t{{.Ports}}' | grep 3100
```

2. If it's a backupctl container, stop it first:

```bash
# Stop dev environment
scripts/dev.sh down

# Stop production
docker compose down
```

3. If it's another process entirely:

```bash
lsof -i :3100
```

4. Alternatively, change the port in `.env`:

```env
APP_PORT=3200
```

> **Rule of thumb:** Never run `docker-compose.yml` (prod) and `docker-compose.dev.yml` (dev) simultaneously. They share the same port, database container name (`backupctl-audit-db`), and volume (`backupctl-audit-data`).

---

### Restic Init Fails with SSH_FX_FAILURE

**Symptom:**

```
Fatal: create repository at sftp:u547206@host:/backups/myproject failed:
  sftp: "Failure" (SSH_FX_FAILURE)
```

**Why:** The remote directory does not exist on the Hetzner Storage Box, and restic cannot create parent directories over SFTP.

**Fix:**

Create the directories manually via SFTP before running `restic init`:

```bash
# Connect to the storage box and create directories
docker exec -i backupctl-dev sftp -i /home/node/.ssh/id_ed25519 \
  -P 23 -o StrictHostKeyChecking=accept-new \
  u547206@u547206.your-storagebox.de <<'EOF'
mkdir backups
mkdir backups/myproject
bye
EOF
```

Then initialize the restic repository:

```bash
scripts/dev.sh cli restic myproject init
```

Expected output:

```
created restic repository 51daba18a8 at sftp:u547206@host:backups/myproject

Please note that knowledge of your password is required to access
the repository. Losing your password means that your data is
irrecoverably lost.
```

> **Tip:** For each new project, repeat the `mkdir` + `restic init` steps. You only need to do this once per project.

---

### Restic Repository Does Not Exist

**Symptom:**

```
Fatal: repository does not exist: unable to open config file: Lstat: file does not exist
Is there a repository at the following location?
sftp:u547206@host:backups/myproject
```

**Why:** The restic repository has not been initialized yet. Every new project needs a one-time `restic init` before backups can run.

**Fix:**

```bash
# Dev environment
scripts/dev.sh cli restic myproject init

# Production
docker exec backupctl node dist/cli.js restic myproject init
```

**Also check the repository path format.** Hetzner Storage Boxes use relative paths from the user's home directory:

```yaml
# Relative to the storage box user's home (avoid a leading slash, e.g. not `/backups/...`)
restic:
  repository_path: backups/myproject
```

The resulting SFTP URI should look like `sftp:user@host:backups/myproject` (no leading `/` after the colon).

---

### Restic Fails with "Configuration key HETZNER_SSH_KEY_PATH does not exist"

**Symptom:**

```
TypeError: Configuration key "HETZNER_SSH_KEY_PATH" does not exist
```

This appears both during startup recovery and when running commands.

**Why:** The `HETZNER_SSH_KEY_PATH` environment variable is missing from `.env`. This variable tells restic which SSH private key to use for SFTP connections.

**Fix:**

Add the variable to `.env`. The path must be the key's location **inside the container**, not on the host:

```env
HETZNER_SSH_KEY_PATH=/home/node/.ssh/id_ed25519
```

This works because `docker-compose.dev.yml` mounts `./ssh-keys:/home/node/.ssh:ro`, so your local `ssh-keys/id_ed25519` becomes `/home/node/.ssh/id_ed25519` inside the container.

After adding the variable, restart the container to pick it up:

```bash
scripts/dev.sh restart    # dev
# or
docker compose restart    # prod
```

**Verify the mapping:**

```
Host (your machine)           Container
─────────────────────────     ──────────────────────
./ssh-keys/id_ed25519    →    /home/node/.ssh/id_ed25519
./ssh-keys/id_ed25519.pub →  /home/node/.ssh/id_ed25519.pub
./ssh-keys/config         →   /home/node/.ssh/config
./ssh-keys/known_hosts    →   /home/node/.ssh/known_hosts
```

---

### Restic Hangs or Fails on Non-Standard SSH Port

**Symptom:**

Restic commands hang for 30+ seconds then fail, or SSH shows "Connection refused" despite the storage box being reachable from the host.

**Why:** Hetzner Storage Boxes use SSH port **23** (not the standard 22). If the SSH port is not passed to restic's SSH subprocess, it defaults to port 22 and times out.

**Fix:**

Ensure `HETZNER_SSH_PORT` is set in `.env`:

```env
HETZNER_SSH_PORT=23
```

backupctl passes this to restic via the `RESTIC_SSH_COMMAND` environment variable, which constructs the full SSH command:

```
ssh -i /home/node/.ssh/id_ed25519 -p 23 -o StrictHostKeyChecking=accept-new
```

**Verify SSH connectivity from inside the container:**

```bash
docker exec backupctl-dev ssh -i /home/node/.ssh/id_ed25519 \
  -p 23 -o StrictHostKeyChecking=accept-new \
  u547206@u547206.your-storagebox.de ls
```

If this works, restic will too.

**Alternatively, use an SSH config file** (`ssh-keys/config`):

```
Host u547206.your-storagebox.de
    User u547206
    Port 23
    IdentityFile /home/node/.ssh/id_ed25519
    StrictHostKeyChecking accept-new
```

---

### GPG Key Not Found During Dry Run

**Symptom:**

```
GPG key not found: Command "gpg --list-keys user@example.com" failed:
gpg: error reading key: No public key
```

**Why:** The GPG public key for the configured recipient is not in the container's GPG keyring. This happens when:
- The key file is missing from `gpg-keys/`
- The key file has the wrong extension (must be `.pub` or `.gpg`)
- The container started before the key was placed in the directory

**Fix:**

**Step 1** — Place the GPG public key in the `gpg-keys/` directory:

```bash
# Export from your local keyring
gpg --export --armor backup@company.com > ./gpg-keys/backup.pub

# Or copy an existing key file
cp /path/to/backup-key.pub.gpg ./gpg-keys/
```

**Step 2** — Verify the file is there with the correct extension:

```bash
ls -la gpg-keys/
# Should show: backupctl-backup.pub (or .gpg)
```

**Step 3** — Restart the container. `GpgKeyManager` auto-imports all `.pub` and `.gpg` files from `gpg-keys/` on startup:

```bash
scripts/dev.sh restart
```

Look for the import log line:

```
[GpgKeyManager] Auto-imported 1 GPG key(s) from ./gpg-keys
```

**Step 4** — Verify the key is in the keyring:

```bash
docker exec backupctl-dev gpg --list-keys
```

Expected:

```
/root/.gnupg/pubring.kbx
-------------------------
pub   ed25519 2026-03-15 [SC]
      AB12CD34EF56...
uid           [unknown] Backup Key <backup@company.com>
```

**Step 5** — Confirm the recipient in `projects.yml` matches the key's UID or email:

```yaml
encryption:
  enabled: true
  type: gpg
  recipient: backup@company.com  # Must match the GPG key
```

---

### .env Changes Not Taking Effect

**Symptom:**

You add or change a variable in `.env`, but the application still uses the old value. For example, adding `HETZNER_SSH_KEY_PATH` but still getting "Configuration key does not exist."

**Why:** Docker Compose reads `env_file` at container **start time**, not continuously. Changes to `.env` require a container restart.

**Fix:**

```bash
# Dev environment
scripts/dev.sh restart

# Production
docker compose restart
```

> **Important:** `docker compose restart` is enough — you don't need to rebuild. The `.env` file is read by Docker Compose (via `env_file: .env`) and injected as OS environment variables. NestJS `ConfigModule` picks them up from `process.env`.

**Verify the variable is set inside the container:**

```bash
docker exec backupctl-dev printenv | grep HETZNER
# HETZNER_SSH_HOST=u547206.your-storagebox.de
# HETZNER_SSH_USER=u547206
# HETZNER_SSH_PORT=23
# HETZNER_SSH_KEY_PATH=/home/node/.ssh/id_ed25519
```

---

### Dev and Prod Containers Conflict

**Symptom:**

Starting production containers while dev is running causes errors:
- Port 3100 already allocated
- `backupctl-audit-db` container gets recreated
- Data in the audit database is lost
- Orphan container warnings

**Why:** Both `docker-compose.yml` and `docker-compose.dev.yml` share:
- Port `3100` (configurable via `APP_PORT`)
- Container name `backupctl-audit-db`
- Volume name `backupctl-audit-data`
- Network name `backupctl-network`

This is by design — dev and prod are **mutually exclusive** environments.

**Fix:**

Always stop one before starting the other:

```bash
# Switch from dev to prod
scripts/dev.sh down
scripts/backupctl-manage.sh deploy

# Switch from prod to dev
docker compose down
scripts/dev.sh up
```

**Quick check — which environment is running?**

```bash
docker ps --format '{{.Names}}' | grep backupctl
```

- `backupctl-dev` — dev environment is running
- `backupctl` — prod environment is running

---

### Dry Run Shows "No database dumper registered"

**Symptom:**

```
No database dumper registered for type: postgres
```

**Why:** The `DumperBootstrapService` didn't run. This service registers database adapter factories (postgres, mysql, mongo) into the `DumperRegistry` on startup.

**Fix:**

1. Verify the container started cleanly — check for startup errors:

```bash
docker logs backupctl-dev 2>&1 | head -30
```

2. If using the dev environment, ensure the source code is mounted correctly:

```bash
docker exec backupctl-dev ls /app/src/domain/backup/infrastructure/adapters/dumpers/
# Should list: dumper-bootstrap.service.ts, postgres-dump.adapter.ts, etc.
```

3. Restart the container:

```bash
scripts/dev.sh restart
```

4. Run the dry-run again:

```bash
scripts/dev.sh cli run myproject --dry-run
```

---

### Dry Run Shows "No notifier registered"

**Symptom:**

```
No notifier registered for type: slack
```

**Why:** The `NotifierBootstrapService` registers notifier adapters from `.env` config on startup. If the required env var is missing, the adapter is skipped.

**Fix:**

For **Slack**, ensure `SLACK_WEBHOOK_URL` is set in `.env`:

```env
NOTIFICATION_TYPE=slack
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T.../B.../xxx
```

For **Webhook**, ensure `WEBHOOK_URL` is set:

```env
NOTIFICATION_TYPE=webhook
WEBHOOK_URL=https://your-server.com/backup-webhook
```

For **Email**, ensure SMTP is configured:

```env
NOTIFICATION_TYPE=email
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=backupctl@example.com
SMTP_PASSWORD=secret
SMTP_TO=admin@example.com
SMTP_FROM=backupctl@example.com
```

After adding the variables, restart:

```bash
scripts/dev.sh restart
```

---

### SSH Warning About Post-Quantum Key Exchange

**Symptom:**

Every SSH/restic command shows:

```
** WARNING: connection is not using a post-quantum key exchange algorithm.
** This session may be vulnerable to "store now, decrypt later" attacks.
** The server may need to be upgraded. See https://openssh.com/pq.html
```

**Why:** This is an informational warning from OpenSSH 9.x+. The SSH server (Hetzner Storage Box) doesn't support post-quantum key exchange yet. **This does not affect functionality** — connections still work and are encrypted with classical algorithms.

**What to do:** Nothing. This is safe to ignore. The warning will disappear once Hetzner upgrades their SSH servers to support post-quantum algorithms.

If you want to suppress the warning, add to `ssh-keys/config`:

```
Host *.your-storagebox.de
    PQCWarning no
```

> **Note:** `PQCWarning` requires OpenSSH 9.9+. Older versions will ignore this option silently.

---

### First Backup Checklist

Before running your first real backup, walk through this checklist. Each item maps to a dry-run check.

#### Step 1: Configuration

```bash
scripts/dev.sh cli config validate
```

Verify `config/projects.yml` loads without errors and all `${}` variables resolve.

#### Step 2: Dry Run

```bash
scripts/dev.sh cli run myproject --dry-run
```

All 6 checks should pass:

```
=== Dry Run: myproject ===

  Config loaded         — project config is valid
  Database dumper        — adapter found for type: postgres
  Notifier              — adapter found for type: slack
  Restic repo           — repository accessible
  Disk space            — XX GB free (minimum: 5 GB)
  GPG key               — key found for recipient (if encryption enabled)

All checks passed — myproject is ready for backup.
```

#### Step 3: Verify Database Connectivity

The dry-run checks that a dumper is registered, but doesn't test the actual database connection. Verify manually:

```bash
# PostgreSQL
docker exec backupctl-dev pg_isready -h <db-host> -p <db-port> -U <db-user>

# MySQL
docker exec backupctl-dev mysqladmin ping -h <db-host> -P <db-port> -u <db-user> -p

# MongoDB
docker exec backupctl-dev mongosh --host <db-host> --port <db-port> --eval "db.runCommand({ping:1})"
```

> **Important:** The database host must be reachable from inside the Docker network. If your database runs on the host machine, use `host.docker.internal` (macOS/Windows) or the host's Docker bridge IP (Linux).

#### Step 4: Run the Backup

```bash
scripts/dev.sh cli run myproject
```

#### Step 5: Verify

```bash
# Check the audit log
scripts/dev.sh cli status myproject --last 1

# List remote snapshots
scripts/dev.sh cli snapshots myproject --last 1
```

#### Quick Reference: Required .env Variables

| Variable | Example | Purpose |
|---|---|---|
| `AUDIT_DB_PASSWORD` | `eR199naK...` | Audit database password |
| `HETZNER_SSH_HOST` | `u547206.your-storagebox.de` | Storage box hostname |
| `HETZNER_SSH_USER` | `u547206` | Storage box SSH user |
| `HETZNER_SSH_PORT` | `23` | Storage box SSH port |
| `HETZNER_SSH_KEY_PATH` | `/home/node/.ssh/id_ed25519` | SSH key path **inside container** |
| `RESTIC_PASSWORD` | `pNJ7bFj0...` | Restic repository encryption password |
| `SLACK_WEBHOOK_URL` | `https://hooks.slack.com/...` | Slack notification webhook (if using slack) |
| Per-project DB password | `MYPROJECT_DB_PASSWORD=...` | Referenced via `${...}` in projects.yml |

#### Quick Reference: Required Files

```
backupctl/
├── .env                              # All secrets and configuration
├── config/
│   └── projects.yml                  # Project backup definitions
├── ssh-keys/
│   ├── id_ed25519                    # SSH private key (chmod 600)
│   ├── id_ed25519.pub                # SSH public key
│   ├── config                        # SSH client config (host, port, key)
│   └── known_hosts                   # Storage box host key
└── gpg-keys/
    └── backup.pub                    # GPG public key (if encryption enabled)
```

---

### pg_dump Version Mismatch ("server version: 17.x; pg_dump version: 9.x")

**Symptom:**

```
pg_dump: server version: 17.9; pg_dump version: 9.4.14
pg_dump: aborting because of server version mismatch
```

**Why:** `pg_dump` requires the client version to be >= the server version. Alpine Linux's default `postgresql-client` package ships an ancient version (9.4). If your target database runs PostgreSQL 14+, the dump will fail.

**Fix:** backupctl's Dockerfiles already install `postgresql17-client` from Alpine edge, which includes `pg_dump` 17. If you see this error, your container is using a stale image.

Rebuild the container:

```bash
# Dev
scripts/dev.sh restart

# Production
docker compose up -d --build
```

Verify inside the container:

```bash
docker exec backupctl-dev pg_dump --version
# pg_dump (PostgreSQL) 17.9
```

> **Note:** If you're running backupctl without Docker (local development), ensure your system `pg_dump` matches or exceeds the target database version. On macOS: `brew install postgresql@17`.

---

### GPG "Unusable public key" During Encrypt Stage

**Symptom:**

```
gpg: CF7D15E776A1FD1E: There is no assurance this key belongs to the named user
gpg: encryption failed: Unusable public key
```

**Why:** GPG requires trust to be set on imported public keys before using them for encryption. In a non-interactive container environment, keys imported from files have "unknown" trust level by default.

**Fix:** backupctl already passes `--trust-model always` to GPG, so this should not occur in normal operation. If you see this error, your container image is outdated.

Rebuild:

```bash
scripts/dev.sh restart     # dev
docker compose up -d --build  # production
```

If you're running GPG commands manually inside the container and hit this, add `--trust-model always`:

```bash
gpg --batch --yes --trust-model always --encrypt \
  --recipient backup@company.com \
  --output file.dump.gpg file.dump
```

---

### Docker Cannot Reach Hetzner Storage Box (Port 23 Blocked)

**Symptom:**

From the Mac terminal, SSH to Hetzner works. From inside Docker, all TCP connections to the storage box are refused:

```bash
# Works from Mac
nc -z u547206.your-storagebox.de 23   # succeeds

# Fails from Docker
docker exec backupctl-dev nc -z u547206.your-storagebox.de 23   # fails
```

**Why:** This is an ISP/router issue, not a Hetzner or Docker issue. Many ISPs block outbound TCP port 23 (telnet) on **IPv4**. Your Mac connects to Hetzner over **IPv6** (bypassing the block), but the Docker VM (Colima or Docker Desktop) only supports **IPv4** outbound.

You can verify this:

```bash
# Host IPv4 — blocked
nc -4 -z -w 3 u547206.your-storagebox.de 23   # fails

# Host IPv6 — works
nc -6 -z -w 3 u547206.your-storagebox.de 23   # succeeds

# Docker always uses IPv4
docker exec backupctl-dev curl -s ifconfig.me   # shows IPv4 address
curl -s ifconfig.me                               # shows IPv6 address (different!)
```

**Fix:** Use a `socat` relay on the Mac host to bridge IPv4 traffic to Hetzner over IPv6:

```bash
# Install socat (one-time)
brew install socat

# Get the storage box IPv6 address
dig AAAA u547206.your-storagebox.de +short
# e.g., 2a01:4f8:2b01:ac::2

# Start the relay
socat "TCP4-LISTEN:2323,fork,reuseaddr" "TCP6:[2a01:4f8:2b01:ac::2]:23" &
```

Then configure `docker-compose.dev.yml` to route through the relay:

```yaml
environment:
  HETZNER_SSH_HOST: host.docker.internal
  HETZNER_SSH_PORT: "2323"
```

See the [Development Guide](13-development.md#hetzner-storage-box-relay-macos) for full setup instructions.

> **Note:** This is a **macOS development-only** workaround. On Linux production servers, Docker shares the host's network and IPv6 works natively.

---

### What is docker_network in projects.yml?

**Question:** What is the `docker_network` field in `projects.yml` and when do I need it?

**Answer:** `docker_network` is an optional field that tells backupctl which Docker network to join in order to reach a project's database.

```yaml
projects:
  - name: my-app
    docker_network: myapp_default   # optional
    database:
      host: postgres                # hostname on that network
```

**When you need it:**
- Your database runs in a separate Docker Compose stack (e.g., your application's own `docker-compose.yml`)
- The database container is on a different Docker network than backupctl

**When you don't need it:**
- The database is on the host machine (use `host.docker.internal` as the host)
- The database is already on the same Docker network as backupctl

On `scripts/dev.sh up` and `restart`, the startup script automatically runs `docker network connect` for each project's declared network. The same logic runs in production via `scripts/backupctl-manage.sh deploy`.

To see available networks:

```bash
docker network ls
```

---

### How to Connect backupctl to Another Docker Compose Project's Database

**Symptom:** `scripts/dev.sh cli run myproject --dry-run` fails because the database host is unreachable. The database runs in another Docker Compose project.

**Why:** Each Docker Compose project creates its own isolated network. Containers on different networks cannot reach each other by default.

**Fix:**

**Step 1** — Find the target network name:

```bash
docker network ls | grep myapp
# myapp_default
```

**Step 2** — Add `docker_network` to the project in `config/projects.yml`:

```yaml
projects:
  - name: my-app
    docker_network: myapp_default
    database:
      host: postgres     # the service name in the other docker-compose.yml
      port: 5432
      # ...
```

**Step 3** — Restart the dev environment:

```bash
scripts/dev.sh restart
```

The script will automatically connect to the network:

```
  ✔ Connected to network: myapp_default
```

**Step 4** — Verify connectivity:

```bash
docker exec backupctl-dev pg_isready -h postgres -p 5432
# postgres:5432 - accepting connections
```

---

## What's Next

- **Runtime troubleshooting** — [Troubleshooting](12-troubleshooting.md) covers issues after initial setup.
- **Configuration reference** — [Configuration](05-configuration.md) for all `.env` and `projects.yml` options.
- **CLI commands** — [CLI Reference](06-cli-reference.md) for all 14 commands.
- **Daily operations** — [Cheatsheet](10-cheatsheet.md) for copy-paste commands.
