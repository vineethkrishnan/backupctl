<p align="center">
  <strong>backupctl</strong><br>
  <em>Backup orchestration for databases, files, or both. One config, zero babysitting.</em>
</p>

<p align="center">
  <a href="https://nestjs.com/"><img src="https://img.shields.io/badge/NestJS-11-ea2845?logo=nestjs&logoColor=white" alt="NestJS 11"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.7-3178c6?logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://www.docker.com/"><img src="https://img.shields.io/badge/Docker-Compose-2496ed?logo=docker&logoColor=white" alt="Docker"></a>
  <a href="https://www.postgresql.org/"><img src="https://img.shields.io/badge/PostgreSQL-16-4169e1?logo=postgresql&logoColor=white" alt="PostgreSQL"></a>
  <a href="https://restic.net/"><img src="https://img.shields.io/badge/Restic-0.17-00ADD8" alt="Restic"></a>
  <a href="https://jestjs.io/"><img src="https://img.shields.io/badge/Tests-342-c21325?logo=jest&logoColor=white" alt="Jest"></a>
</p>

---

backupctl is a standalone Docker service that orchestrates scheduled backups for multiple projects — databases (PostgreSQL, MySQL, MongoDB), files, or both — with encrypted remote storage via [restic](https://restic.net/), configurable notifications, and a full CLI for day-to-day operations.

## Highlights

- **Multi-project** — single service manages dozens of projects from one YAML config
- **Flexible scope** — back up databases, files, or both per project; PostgreSQL, MySQL, MongoDB out of the box
- **Restic + Hetzner Storage Box** — encrypted, deduplicated backups over SFTP
- **GPG encryption** — optional per-project dump encryption before upload
- **Notifications** — Slack, Email (SMTP/TLS), Webhook (JSON + markdown)
- **Pre/post hooks** — run arbitrary shell commands around each backup
- **Retry with backoff** — configurable exponential retry for transient failures
- **Audit trail** — every run tracked in PostgreSQL with real-time stage progress
- **Crash recovery** — orphan detection, lock cleanup, fallback replay on startup
- **14 CLI commands** — backup, restore, status, health, snapshots, prune, logs, config, cache, restic passthrough
- **Dry run** — validates config, adapters, connectivity, disk, and GPG before a real run
- **Zero-edit install** — interactive wizard generates `.env`, SSH keys, and project config

## Quick Start

```bash
# One-line install (pulls pre-built image)
curl -fsSL https://raw.githubusercontent.com/vineethkrishnan/backupctl/main/scripts/get-backupctl.sh | bash

# Or from source
git clone https://github.com/vineethkrishnan/backupctl.git && cd backupctl
./scripts/install.sh

# Verify
docker exec backupctl node dist/cli.js health

# Run first backup
docker exec backupctl node dist/cli.js run myproject --dry-run
docker exec backupctl node dist/cli.js run myproject
```

```bash
# Docker Hub
docker pull vineethnkrishnan/backupctl:latest

# GitHub Container Registry
docker pull ghcr.io/vineethkrishnan/backupctl:latest
```

## CLI at a Glance

```bash
backupctl run <project> [--dry-run]    # trigger or simulate backup
backupctl run --all                    # back up all projects
backupctl status [project]             # backup status
backupctl health                       # audit DB, restic, disk, SSH
backupctl restore <proj> <snap> <path> # restore from snapshot
backupctl snapshots <project>          # list restic snapshots
backupctl prune <project> | --all      # remove old snapshots
backupctl logs <project> [--failed]    # query audit log
backupctl config validate|show|reload  # config management
backupctl cache <project> [--clear]    # restic cache management
backupctl restic <project> <cmd>       # restic passthrough
```

Inside Docker: `docker exec backupctl node dist/cli.js <command>`

## Architecture

Hexagonal (Ports & Adapters) with strict layer separation.

```
                  ┌──────────────────────────────────────┐
                  │          Infrastructure               │
                  │   CLI · HTTP · Scheduler  (driving)   │
                  │              │                        │
                  │   ┌──────────┴───────────┐           │
                  │   │   Application Layer   │           │
                  │   │ Orchestrator·Registry │           │
                  │   └──────────┬───────────┘           │
                  │              │                        │
                  │   ┌──────────┴───────────┐           │
                  │   │    Domain Layer       │           │
                  │   │ Ports·Models·Policies │           │
                  │   └──────────┬───────────┘           │
                  │              │                        │
                  │   Adapters (driven)                   │
                  │   Dumpers·Restic·Notifiers·GPG·Audit  │
                  └──────────────────────────────────────┘
```

`infrastructure/` → `application/` → `domain/` — never the reverse.

## Documentation

**[backupctl.vineethnk.in](https://backupctl.vineethnk.in/)** — full documentation site.

Also available in [`docs/`](docs/README.md):

| #   | Document                                      | What's inside                                              |
| --- | --------------------------------------------- | ---------------------------------------------------------- |
| 1   | [Introduction](docs/01-introduction.md)       | Features, design goals, tech stack                         |
| 2   | [Architecture](docs/02-architecture.md)       | Hexagonal design, layers, naming, project structure        |
| 3   | [Requirements](docs/03-requirements.md)       | PRD summary, goals, non-goals, audit schema                |
| 4   | [Installation](docs/04-installation.md)       | Prerequisites, wizard, manual setup, Docker                |
| 5   | [Configuration](docs/05-configuration.md)     | `.env` reference, `projects.yml` schema, resolution rules  |
| 6   | [CLI Reference](docs/06-cli-reference.md)     | All 14 commands with syntax, options, exit codes, examples |
| 7   | [Bash Scripts](docs/07-bash-scripts.md)       | `install.sh`, `dev.sh`, `backupctl-manage.sh`           |
| 8   | [Backup Flow](docs/08-backup-flow.md)         | 11-step flow, retry, concurrency, recovery, notifications  |
| 9   | [Restore Guide](docs/09-restore-guide.md)     | Per-DB restore, decrypt, decompress, `--guide`             |
| 10  | [Cheatsheet](docs/10-cheatsheet.md)           | Daily ops quick reference, one-liners                      |
| 11  | [Adding Adapters](docs/11-adding-adapters.md) | Extending with new DB engines, notifiers, storage backends |
| 12  | [Troubleshooting](docs/12-troubleshooting.md) | Common issues, debug commands, log locations               |

## Tech Stack

| Component      | Technology                          |
| -------------- | ----------------------------------- |
| Runtime        | Node.js 20 LTS                      |
| Framework      | NestJS 11                           |
| CLI            | nest-commander                      |
| ORM            | TypeORM (explicit migrations)       |
| Audit DB       | PostgreSQL 16                       |
| Scheduler      | @nestjs/schedule                    |
| Logging        | Winston + daily rotation            |
| Containers     | Docker + Docker Compose             |
| Remote storage | Restic → Hetzner Storage Box (SFTP) |
| Encryption     | GPG                                 |
| Testing        | Jest (342 tests)                    |

## Contributing

```bash
npm install          # install deps
npm run start:dev    # dev server (watch)
npm test             # run tests
npm run lint         # lint
npm run build        # production build
```

See [Adding Adapters](docs/11-adding-adapters.md) for extending the system.

## License

[MIT](LICENSE)
