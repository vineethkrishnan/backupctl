# Restore Guide

## Overview

backupctl extracts backup files from restic snapshots — it does **not** automatically import data into your database. This is a deliberate design decision: automatic imports risk overwriting production data, and every database engine has its own import nuances that require operator judgment.

The restore process depends on whether your backup is **encrypted** or **unencrypted**:

| Backup Type | Steps |
|-------------|-------|
| Unencrypted | Restore from restic → Import to database |
| GPG-encrypted | Restore from restic → Decrypt with GPG → Import to database |

::: info Command notation
All commands below use the `backupctl` CLI shortcut (installed via `scripts/install-cli.sh`). If you haven't installed it, prefix commands with `docker exec backupctl node dist/cli.js` instead.

Example: `docker exec backupctl node dist/cli.js snapshots myproject` instead of `backupctl snapshots myproject`
:::

The `--guide` flag prints a config-aware restore guide tailored to your project's exact setup (database type, encryption status, GPG recipient).

---

## Quick Restore

**Unencrypted backup:**

```bash
# Restore latest snapshot
backupctl restore myproject latest /tmp/restore

# Restore + decompress + show import guide
backupctl restore myproject latest /tmp/restore --only db --decompress --guide
```

**Encrypted backup:**

```bash
# Step 1: Restore from restic (gets the .dump.gpg file)
backupctl restore myproject latest /tmp/restore --only db

# Step 2: Copy .gpg file to a machine that has the private key
docker cp backupctl:/tmp/restore/myproject_backup_20260320.dump.gpg ./

# Step 3: Decrypt with your private GPG key
gpg --decrypt myproject_backup_20260320.dump.gpg > myproject_backup_20260320.dump

# Step 4: Import to database
pg_restore -h localhost -p 5432 -U myuser -d mydb myproject_backup_20260320.dump
```

---

## Step-by-Step: Unencrypted Backup

### 1. Find the snapshot

```bash
backupctl snapshots myproject --last 5
```

Output:

```
Snapshots for myproject:

ID          Time                        Tags
────────────────────────────────────────────────────────────────────────
35ba0d0439  2026-03-20T02:00:27Z        project:myproject, db:postgres
aa4e3c4dae  2026-03-19T02:00:37Z        project:myproject, db:postgres
```

Note the snapshot ID (e.g., `35ba0d0439`).

### 2. Restore from restic

```bash
backupctl restore myproject 35ba0d0439 /tmp/restore
```

### 3. Check restored files

```bash
docker exec backupctl ls -la /tmp/restore/
```

You should see a `.dump` file (PostgreSQL custom format, already compressed internally).

### 4. Import to database

```bash
# PostgreSQL
pg_restore -h <HOST> -p <PORT> -U <USER> -d <DBNAME> /tmp/restore/myproject_backup_20260320.dump

# MySQL
mysql -h <HOST> -P <PORT> -u <USER> -p <DBNAME> < /tmp/restore/myproject_backup_20260320.sql

# MongoDB
mongorestore --host <HOST> --port <PORT> -u <USER> -d <DBNAME> --gzip --archive=/tmp/restore/myproject_backup_20260320.archive
```

### 5. Clean up

```bash
docker exec backupctl rm -rf /tmp/restore
```

---

## Step-by-Step: Encrypted Backup (GPG)

When GPG encryption is enabled, the backup flow produces a `.dump.gpg` file instead of a plain `.dump`. The file is encrypted with the **public key** configured in your project. You need the corresponding **private key** to decrypt it.

::: danger Important
**Never store the GPG private key on the backup server.** The private key should remain on a secure machine (your workstation, a hardware key, or a dedicated restore server). This ensures that even if the backup server is compromised, the attacker cannot decrypt your backups.
:::

### 1. Find the snapshot

```bash
backupctl snapshots myproject --last 5
```

### 2. Restore the encrypted dump from restic

```bash
backupctl restore myproject aa4e3c4dae /tmp/restore --only db
```

### 3. Copy the encrypted file to your local machine

The `.dump.gpg` file needs to be decrypted on a machine that has the GPG private key:

```bash
# Copy from the container to the Docker host
docker cp backupctl:/tmp/restore/data/backups/myproject/myproject_backup_20260320.dump.gpg /tmp/

# If accessing a remote server, copy to your local machine
scp user@server:/tmp/myproject_backup_20260320.dump.gpg ./
```

### 4. Decrypt with GPG

On the machine with the private key:

```bash
gpg --decrypt myproject_backup_20260320.dump.gpg > myproject_backup_20260320.dump
```

Expected output:

```
gpg: encrypted with rsa4096 key, ID CF7D15E776A1FD1E, created 2026-03-18
      "Your Name <your@email.com>"
```

### 5. Verify the decrypted dump

Before importing, verify the dump is valid and not corrupted:

```bash
# PostgreSQL: list table of contents
pg_restore --list myproject_backup_20260320.dump | head -20

# Check file size is reasonable
ls -lh myproject_backup_20260320.dump
```

### 6. Verify integrity (optional but recommended)

Compare the SHA-256 checksum of the decrypted dump against the original (if you still have the pre-encryption `.dump` on the server):

```bash
# On the server
docker exec backupctl sha256sum /data/backups/myproject/myproject_backup_20260320.dump

# On your local machine
shasum -a 256 myproject_backup_20260320.dump
```

Both checksums should be identical, confirming zero corruption through the encrypt → restic → restore → decrypt chain.

### 7. Import to database

```bash
pg_restore -h localhost -p 5432 -U myuser -d mydb myproject_backup_20260320.dump
```

### 8. Clean up

```bash
# On your local machine
rm myproject_backup_20260320.dump myproject_backup_20260320.dump.gpg

# On the server
docker exec backupctl rm -rf /tmp/restore
```

---

## Using --guide for Config-Aware Instructions

The `--guide` flag generates restore instructions tailored to your project's configuration. It reads the project config and adjusts the steps based on whether encryption is enabled, which database type is configured, and which GPG recipient to use.

```bash
backupctl restore myproject latest /tmp/restore --guide
```

**Example output for an encrypted PostgreSQL project:**

```
Restore Guide for myproject (postgres — mydb)
════════════════════════════════════════════════════════════

Step 1: Restore snapshot from Restic
  backupctl restore myproject <SNAPSHOT_ID> <OUTPUT_PATH>

  To find available snapshots:
  backupctl snapshots myproject

Step 2: Decrypt the dump (GPG-encrypted)
  gpg --decrypt <file>.dump.gpg > <file>.dump
  Recipient: your@email.com
  ⚠ The private key must be available in your GPG keyring

Step 3: Restore to database
  pg_restore -h <HOST> -p <PORT> -U <USER> -d mydb <file>.dump

────────────────────────────────────────────────────────────
Tip: Connection details are in your projects.yml config.
Tip: Never store the GPG private key on the backup server.
```

**Example output for an unencrypted project:**

```
Restore Guide for myproject (postgres — mydb)
════════════════════════════════════════════════════════════

Step 1: Restore snapshot from Restic
  backupctl restore myproject <SNAPSHOT_ID> <OUTPUT_PATH>

  To find available snapshots:
  backupctl snapshots myproject

Step 2: Restore to database
  pg_restore -h <HOST> -p <PORT> -U <USER> -d mydb <file>.dump

────────────────────────────────────────────────────────────
Tip: Connection details are in your projects.yml config.
```

---

## Restore Options

### `--only db`

Restore only the database dump file, skipping asset directories:

```bash
backupctl restore myproject latest /tmp/restore --only db
```

### `--only assets`

Restore only asset files, skipping the database dump:

```bash
backupctl restore myproject latest /tmp/restore --only assets
```

### `--decompress`

Automatically decompress (and decrypt, if applicable) files after restore:

```bash
backupctl restore myproject latest /tmp/restore --decompress
```

### Combine all options

```bash
backupctl restore myproject latest /tmp/restore --only db --decompress --guide
```

---

## Database Import Commands

### PostgreSQL

**Custom format (`.dump`) — the default:**

```bash
# Restore into existing database (drops and recreates objects)
pg_restore -h localhost -p 5432 -U myuser -d mydb --clean --if-exists restored.dump

# Restore into a fresh database
pg_restore -h localhost -p 5432 -U myuser -d mydb --create restored.dump

# List contents without importing (useful for verification)
pg_restore --list restored.dump
```

### MySQL

```bash
# Decompress first
gunzip restored.sql.gz

# Import
mysql -h localhost -P 3306 -u myuser -p mydb < restored.sql

# For large databases, disable FK checks for speed
mysql -h localhost -P 3306 -u myuser -p mydb \
  -e "SET FOREIGN_KEY_CHECKS=0; SOURCE restored.sql; SET FOREIGN_KEY_CHECKS=1;"
```

### MongoDB

```bash
# From archive
mongorestore --host localhost --port 27017 -u myuser -d mydb \
  --gzip --archive=restored.archive

# From directory
mongorestore --host localhost --port 27017 -u myuser -d mydb \
  --gzip restored_directory/

# Drop existing data before restoring
mongorestore --host localhost --port 27017 -u myuser -d mydb \
  --gzip --drop --archive=restored.archive
```

---

## Selective Restore (Combined vs Separate Snapshots)

### Combined mode (default)

Both database dump and assets in one snapshot. Use `--only` to filter:

```bash
backupctl restore myproject latest /tmp/restore --only db
backupctl restore myproject latest /tmp/restore --only assets
```

### Separate mode

Database and assets are in separate snapshots. Filter by tag using restic directly:

```bash
# List only DB snapshots
backupctl restic myproject snapshots --tag db

# List only asset snapshots
backupctl restic myproject snapshots --tag assets
```

Then restore the specific snapshot by ID.

---

## Direct Restic Restore

For advanced scenarios beyond what the `restore` command provides:

```bash
# Restore with path filters
backupctl restic myproject restore <snapshot-id> \
  --target /tmp/restore --include "/data/backups/myproject"

# Dump a single file to stdout
backupctl restic myproject dump latest \
  /data/backups/myproject/myproject_backup_20260320.dump > restored.dump

# Diff two snapshots
backupctl restic myproject diff abc123 def456
```

---

## Safety Checklist

Before importing a restored dump into any database:

1. **Verify the target** — confirm you are connected to the correct database host and name
2. **Back up the current state** — take a fresh dump before overwriting anything
3. **Restore to staging first** — if not urgent, verify in a staging environment first
4. **Check dump integrity** — for PostgreSQL: `pg_restore --list restored.dump`
5. **Plan for downtime** — large imports take time, schedule a maintenance window
6. **Communicate** — notify your team before performing a production restore

---

## Getting Help

- **Restore not working?** — Check [Troubleshooting](12-troubleshooting.md) for common restore issues
- **Need exact command syntax?** — [CLI Reference](06-cli-reference.md) has full `restore`, `snapshots`, and `restic` details
- **Quick commands** — [Cheatsheet](10-cheatsheet.md) for copy-paste restore commands
- **Still stuck?** — **[Report an issue on GitHub](https://github.com/vineethkrishnan/backupctl/issues/new)**
