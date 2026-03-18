# Restore Guide

## Overview

backupctl extracts backup files from restic snapshots — it does **not** automatically import data into your database. This is a deliberate design decision: automatic imports risk overwriting production data, and every database engine has its own import nuances that require operator judgment.

Restoring a backup is a two-step process:

1. **Extract** — use `backupctl restore` to pull files from a restic snapshot to a local directory
2. **Import** — manually import the extracted dump into your database using the appropriate tool

The `--guide` flag prints database-specific import instructions tailored to each project's configured database type, so you never have to look up the syntax yourself.

## Quick Restore

Restore the most recent snapshot:

```bash
backupctl restore myproject latest /data/restore/
```

Restore a specific snapshot by ID:

```bash
backupctl restore myproject a1b2c3d4 /data/restore/
```

Restore with auto-decompress and import instructions:

```bash
backupctl restore myproject latest /data/restore/ --only db --decompress --guide
```

## Step-by-Step Restore

### 1. Identify the snapshot

List recent snapshots to find the one you need:

```bash
backupctl snapshots myproject --last 10
```

Each snapshot shows a short ID, timestamp, and tags. Note the snapshot ID for the next step.

### 2. Restore files from the snapshot

Extract the snapshot contents to a local directory:

```bash
backupctl restore myproject <snapshot-id> /data/restore/
```

The restore directory will contain the database dump file and, if the project backs up assets, the asset files in their original directory structure.

### 3. Decrypt (if GPG encryption was enabled)

If the project has GPG encryption configured, the dump file will have a `.gpg` extension. Decrypt it before importing:

```bash
gpg --decrypt restored_file.dump.gpg > restored_file.dump
```

Alternatively, use `--decompress` during restore to handle decryption and decompression automatically:

```bash
backupctl restore myproject <snapshot-id> /data/restore/ --decompress
```

### 4. Decompress (if not using --decompress)

If you skipped the `--decompress` flag, decompress manually:

```bash
# For .gz files
gunzip restored_file.sql.gz

# For .dump files (PostgreSQL custom format) — no decompression needed
# pg_restore handles the format natively
```

### 5. Import into the database

This is the manual step. See the [Database Import Instructions](#database-import-instructions) section below for commands specific to each database type, or use `--guide` to have backupctl print them for you:

```bash
backupctl restore myproject latest /data/restore/ --guide
```

## Restore Options

### `--only db`

Restore only the database dump file, skipping any backed-up asset files. Useful when you only need the database and want to avoid pulling large asset directories.

```bash
backupctl restore myproject latest /data/restore/ --only db
```

### `--only assets`

Restore only the asset files, skipping the database dump. Useful for recovering uploaded files, media, or other non-database content.

```bash
backupctl restore myproject latest /data/restore/ --only assets
```

### `--decompress`

Automatically decompress (and decrypt, if applicable) files after restore. Handles `.gz` decompression via gunzip and `.gpg` decryption via GPG.

```bash
backupctl restore myproject latest /data/restore/ --decompress
```

### `--guide`

Print step-by-step import instructions tailored to the project's configured database type. Includes the exact commands with placeholders filled in from the project config.

```bash
backupctl restore myproject latest /data/restore/ --guide
```

You can combine all options:

```bash
backupctl restore myproject latest /data/restore/ --only db --decompress --guide
```

## Database Import Instructions

### PostgreSQL

From a `.dump` file (custom format — the default for PostgreSQL backups):

```bash
pg_restore -h localhost -p 5432 -U myuser -d mydb --clean --if-exists restored_file.dump
```

The `--clean` flag drops existing objects before recreating them. `--if-exists` prevents errors if objects don't exist yet. To restore into a fresh database, omit `--clean`:

```bash
pg_restore -h localhost -p 5432 -U myuser -d mydb --create restored_file.dump
```

From a `.sql` file (plain text format):

```bash
psql -h localhost -p 5432 -U myuser -d mydb < restored_file.sql
```

### MySQL

Decompress the dump first (MySQL backups are gzipped SQL):

```bash
gunzip restored_file.sql.gz
```

Then import:

```bash
mysql -h localhost -P 3306 -u myuser -p mydb < restored_file.sql
```

For large databases, consider disabling foreign key checks to speed up the import:

```bash
mysql -h localhost -P 3306 -u myuser -p mydb -e "SET FOREIGN_KEY_CHECKS=0; SOURCE restored_file.sql; SET FOREIGN_KEY_CHECKS=1;"
```

### MongoDB

From an archive file (the default for MongoDB backups):

```bash
mongorestore --host localhost --port 27017 -u myuser -d mydb \
  --gzip --archive=restored_file.archive
```

From a directory dump:

```bash
mongorestore --host localhost --port 27017 -u myuser -d mydb \
  --gzip restored_directory/
```

To drop the existing collection data before restoring:

```bash
mongorestore --host localhost --port 27017 -u myuser -d mydb \
  --gzip --drop --archive=restored_file.archive
```

## Encrypted Backups

If GPG encryption was enabled for the project, dump files are encrypted before being synced to remote storage. The file will have a `.gpg` extension (e.g., `myproject_backup_20260318_030000.dump.gpg`).

### Manual decryption

```bash
gpg --decrypt restored_file.dump.gpg > restored_file.dump
```

The GPG private key corresponding to the configured recipient must be available in your keyring. If restoring inside the container, keys from the mounted `gpg-keys/` directory are auto-imported on startup.

### Automatic decryption with --decompress

The `--decompress` flag handles both GPG decryption and gzip decompression in the correct order:

```bash
backupctl restore myproject latest /data/restore/ --decompress
```

This is the recommended approach — it handles the decryption/decompression pipeline without manual steps.

## Selective Restore

### Combined snapshots (DB + assets in one snapshot)

When a project backs up both the database and assets together, use `--only` to filter:

```bash
# Database dump only
backupctl restore myproject latest /data/restore/ --only db

# Asset files only
backupctl restore myproject latest /data/restore/ --only assets
```

### Separate snapshots (tagged by type)

If the project uses separate snapshot modes, filter by tag using restic directly:

```bash
backupctl restic myproject snapshots --tag db
backupctl restic myproject snapshots --tag assets
```

Then restore the specific snapshot by ID:

```bash
backupctl restore myproject <db-snapshot-id> /data/restore/
```

## Direct Restic Usage

For advanced restore scenarios beyond what the `restore` command provides, use the restic passthrough:

### Restore with path filters

```bash
backupctl restic myproject restore <snapshot-id> --target /data/restore/ \
  --include "/data/backups/myproject"
```

### Browse snapshots via FUSE mount

Mount a restic repository to explore snapshots interactively:

```bash
backupctl restic myproject mount /mnt/browse
```

Then browse the mounted directory to find files across all snapshots. Unmount when done:

```bash
umount /mnt/browse
```

### Dump a single file to stdout

Extract a single file without a full restore:

```bash
backupctl restic myproject dump latest /data/backups/myproject/myproject_backup_20260318_030000.dump \
  > restored.dump
```

### Diff two snapshots

Compare what changed between two snapshots:

```bash
backupctl restic myproject diff a1b2c3d4 e5f6g7h8
```

## Safety Checklist

Before importing a restored dump into any database:

1. **Verify the target** — confirm you are connected to the correct database host and database name. Double-check connection strings.
2. **Back up the current state** — take a fresh backup of the database you're about to overwrite. Even a quick `pg_dump` or `mysqldump` gives you a rollback path.
3. **Restore to staging first** — if the restore is not urgent, import into a staging environment to verify the data before touching production.
4. **Check dump integrity** — for PostgreSQL custom format, run `pg_restore --list restored_file.dump` to verify the dump is readable. For SQL files, check the file size is reasonable and not truncated.
5. **Plan for downtime** — large database imports can take significant time. Schedule a maintenance window if the database serves live traffic.
6. **Communicate** — notify your team before performing a production restore. Use the project's notification channel if appropriate.

## What's Next

- **Restore not working?** — [Troubleshooting](12-troubleshooting.md) covers common restore issues and diagnostics.
- **Need the exact command syntax?** — [CLI Reference](06-cli-reference.md) has full details on `restore`, `snapshots`, and `restic` commands.
- **Quick commands** — [Cheatsheet](10-cheatsheet.md) has copy-paste restore commands.
