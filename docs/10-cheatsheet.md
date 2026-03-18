# Cheatsheet

Quick-reference commands for daily backupctl operations. For full details, see the [CLI Reference](06-cli-reference.md).

## Daily Operations

```bash
# Run a backup
backupctl run myproject
backupctl run myproject --dry-run
backupctl run --all

# Check status
backupctl status
backupctl status myproject
backupctl status myproject --last 5

# Health check (audit DB, restic repos, disk space, SSH)
backupctl health

# View logs
backupctl logs myproject
backupctl logs myproject --last 20
backupctl logs myproject --failed
```

## Restore

```bash
# List snapshots
backupctl snapshots myproject
backupctl snapshots myproject --last 10

# Restore latest
backupctl restore myproject latest /data/restore/

# Restore specific snapshot
backupctl restore myproject a1b2c3d4 /data/restore/

# Restore DB only + decompress + import guide
backupctl restore myproject latest /data/restore/ --only db --decompress --guide

# Restore assets only
backupctl restore myproject latest /data/restore/ --only assets
```

## Configuration

```bash
# Validate config
backupctl config validate

# Show resolved config (secrets masked)
backupctl config show myproject

# Reload after editing YAML
backupctl config reload

# Import GPG key
backupctl config import-gpg-key /path/to/key.pub.gpg
```

## Maintenance

```bash
# Prune old snapshots (per retention policy)
backupctl prune myproject
backupctl prune --all

# View cache usage
backupctl cache myproject

# Clear cache
backupctl cache myproject --clear
backupctl cache --clear-all
```

## Restic Passthrough

```bash
backupctl restic myproject snapshots        # list snapshots
backupctl restic myproject check            # verify repo integrity
backupctl restic myproject stats            # repo size statistics
backupctl restic myproject ls latest        # list files in latest snapshot
backupctl restic myproject find "*.sql.gz"  # find files across snapshots
backupctl restic myproject unlock           # unlock stuck repository
backupctl restic myproject init             # initialize new repo
backupctl restic myproject diff abc def     # diff two snapshots
backupctl restic myproject mount /mnt       # browse snapshots via FUSE
backupctl restic myproject dump latest /path/to/file > out.dump  # extract single file
```

## Host Scripts

```bash
./scripts/install.sh                            # first-time setup wizard
./scripts/backupctl-manage.sh deploy             # build + start containers
./scripts/backupctl-manage.sh deploy --rebuild   # force rebuild + restart
./scripts/backupctl-manage.sh update             # pull + rebuild + restart
./scripts/backupctl-manage.sh check              # validate prerequisites
./scripts/backupctl-manage.sh logs               # tail container logs
./scripts/backupctl-manage.sh shell              # shell into container
./scripts/backupctl-manage.sh status             # quick status overview
./scripts/backupctl-manage.sh backup-dir         # show backup directory sizes
```

## Docker Commands

```bash
# Container lifecycle
docker compose up -d                 # start all containers
docker compose down                  # stop all containers
docker compose down -v               # stop + remove volumes
docker compose ps                    # check container status
docker compose logs -f backupctl     # follow application logs

# Execute commands inside the container
docker exec backupctl node dist/cli.js health
docker exec backupctl node dist/cli.js run myproject --dry-run
docker exec backupctl node dist/cli.js status
docker exec -it backupctl sh         # interactive shell
```

## Database Import (After Restore)

```bash
# PostgreSQL (custom format)
pg_restore -h localhost -p 5432 -U myuser -d mydb --clean --if-exists restored.dump

# PostgreSQL (plain SQL)
psql -h localhost -p 5432 -U myuser -d mydb < restored.sql

# MySQL
gunzip restored.sql.gz
mysql -h localhost -P 3306 -u myuser -p mydb < restored.sql

# MongoDB (archive)
mongorestore --host localhost --port 27017 -u myuser -d mydb --gzip --archive=restored.archive

# MongoDB (directory)
mongorestore --host localhost --port 27017 -u myuser -d mydb --gzip restored_dir/
```

## GPG Operations

```bash
# Decrypt a backup file
gpg --decrypt file.dump.gpg > file.dump

# List imported keys (inside container)
docker exec backupctl gpg --list-keys

# Import a key (inside container)
docker exec backupctl gpg --import /app/gpg-keys/backup-key.pub.gpg
```

## Diagnostics

```bash
# System-wide health
backupctl health

# Validate config
backupctl config validate

# Pre-flight check (no actual backup)
backupctl run myproject --dry-run

# Check for stale lock files
docker exec backupctl find /data/backups -name ".lock" -ls

# View fallback audit entries
docker exec backupctl cat /data/backups/.fallback-audit/fallback.jsonl

# View today's application log
docker exec backupctl cat /data/backups/.logs/backupctl-$(date +%Y-%m-%d).log

# Force remove a stale lock
docker exec backupctl rm /data/backups/myproject/.lock
```

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General failure |
| `2` | Backup already in progress (lock held) |
| `3` | Configuration validation error |
| `4` | Connectivity error (DB, SSH, restic) |
| `5` | Partial success (`run --all`: some succeeded, some failed) |

## File Locations (Inside Container)

| Path | Description |
|------|-------------|
| `/data/backups/<project>/` | Project backup dumps |
| `/data/backups/<project>/.lock` | Per-project lock file |
| `/data/backups/.fallback-audit/fallback.jsonl` | JSONL fallback audit entries |
| `/data/backups/.logs/` | Winston log files (daily rotation) |
| `/app/config/projects.yml` | Project configuration |
| `/root/.ssh/` | SSH keys for restic SFTP |
| `/app/gpg-keys/` | GPG public/private keys |

## File Locations (Host)

| Path | Description |
|------|-------------|
| `config/projects.yml` | Project configuration (mounted read-only) |
| `.env` | Global secrets and defaults |
| `ssh-keys/` | SSH keys (mounted read-only) |
| `gpg-keys/` | GPG keys (mounted read-only) |
| `scripts/` | Host-side management scripts |

## What's Next

- **Full command details** — [CLI Reference](06-cli-reference.md)
- **Restore walkthrough** — [Restore Guide](09-restore-guide.md)
- **Something broken?** — [Troubleshooting](12-troubleshooting.md)
