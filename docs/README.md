# backupctl Documentation

**backupctl** is a backup orchestration service for databases, files, or both — managing scheduled, encrypted, deduplicated backups for multiple projects from a single Docker container. Built with NestJS 11 and hexagonal architecture, it supports PostgreSQL, MySQL, and MongoDB databases plus arbitrary file/asset directories — with restic remote storage, GPG encryption, audit logging, crash recovery, and a full CLI.

## Documentation

| #  | Page | Description |
|----|------|-------------|
| 1  | [Introduction](01-introduction.md) | What backupctl is, key features, design goals, tech stack |
| 2  | [Architecture](02-architecture.md) | Hexagonal design, layer rules, domain subdomains, dependency injection |
| 3  | [Requirements](03-requirements.md) | PRD summary — goals, non-goals, functional requirements, audit schema |
| 4  | [Installation](04-installation.md) | Setup wizard, Docker deployment, first-run verification |
| 5  | [Configuration](05-configuration.md) | Project YAML format, `.env` globals, config resolution, examples |
| 6  | [CLI Reference](06-cli-reference.md) | All 14 commands with flags, arguments, exit codes, and examples |
| 7  | [Bash Scripts](07-bash-scripts.md) | Host-side scripts: `install.sh`, `dev.sh`, `backupctl-manage.sh` |
| 8  | [Backup Flow](08-backup-flow.md) | The 13-step orchestration pipeline in detail |
| 9  | [Restore Guide](09-restore-guide.md) | Snapshot browsing, file restore, database import, `--guide` mode |
| 10 | [Cheatsheet](10-cheatsheet.md) | Quick-reference commands for daily operations |
| 11 | [Adding Adapters](11-adding-adapters.md) | How to add new database dumpers, notifiers, or storage backends |
| 12 | [Troubleshooting](12-troubleshooting.md) | Common errors, diagnostics, recovery procedures |
| 13 | [Development](13-development.md) | Docker dev environment, networking, socat relay, testing, static analysis |
| 14 | [Migrations](14-migrations.md) | TypeORM migration commands, patterns, and troubleshooting |
| 15 | [FAQ](15-faq.md) | Setup issues, Docker networking, ISP port blocking, SSH/GPG/restic fixes |
| 16 | [Monitoring](16-monitoring.md) | Uptime Kuma push monitors for passive failure detection |
| 17 | [Network](17-network.md) | Docker network management, Docker socket setup, multi-arch image support |

## Quick Links

- **First-time production setup** — [Installation](04-installation.md) + [FAQ](15-faq.md)
- **Development setup** — [Development Guide](13-development.md) (Docker, networking, socat relay, testing)
- **Docker networking** — [Network](17-network.md) (Docker socket, multi-arch images, connect command)
- **Configure a project** — [Configuration](05-configuration.md) (YAML format, docker_network, all fields)
- **Run a backup** — [CLI Reference → `run`](06-cli-reference.md)
- **Restore from snapshot** — [Restore Guide](09-restore-guide.md)
- **Daily commands** — [Cheatsheet](10-cheatsheet.md)
- **Host scripts** — [Bash Scripts](07-bash-scripts.md) (`dev.sh`, `install.sh`, `backupctl-manage.sh`)
- **Database migrations** — [TypeORM migration guide](14-migrations.md)

## Getting Help

If something isn't working, start with the [Troubleshooting](12-troubleshooting.md) guide. It covers common errors, diagnostic commands, and recovery procedures for lock files, audit DB connectivity, restic repos, and more.

If you've checked the troubleshooting guide and FAQ and still need help:

- **[Report an Issue](https://github.com/vineethkrishnan/backupctl/issues/new)** — Bug reports, feature requests, or documentation improvements
- **[View Existing Issues](https://github.com/vineethkrishnan/backupctl/issues)** — Check if someone else has reported the same problem
