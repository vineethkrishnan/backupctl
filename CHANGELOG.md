# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.3](https://github.com/vineethkrishnan/backupctl/compare/v0.1.2...v0.1.3) (2026-03-20)


### Bug Fixes

* **ci:** correct Docker Hub username to vineethnkrishnan ([5feef47](https://github.com/vineethkrishnan/backupctl/commit/5feef47d8c13a114040b5757b0278c84a404f270))

## [0.1.2](https://github.com/vineethkrishnan/backupctl/compare/v0.1.1...v0.1.2) (2026-03-20)


### CI/CD

* consolidate deployment jobs into release workflow ([d070110](https://github.com/vineethkrishnan/backupctl/commit/d07011098c6531c01f68fd17ee1ec122439b6c63))

## [0.1.1](https://github.com/vineethkrishnan/backupctl/compare/v0.1.0...v0.1.1) (2026-03-20)


### Features

* CLI shortcuts, verbose mode, Docker fixes, and documentation overhaul ([c22e14f](https://github.com/vineethkrishnan/backupctl/commit/c22e14f4e302e0f0db7fd2aaa7bca685250472a5))
* **docker:** publish to Docker Hub and add remote installer ([ebb175c](https://github.com/vineethkrishnan/backupctl/commit/ebb175c477213a3b48d4a2b4d89388b889a4bd87))
* initial release of backupctl v0.1.0 ([918d60f](https://github.com/vineethkrishnan/backupctl/commit/918d60f48a02fb3b33e31b1ca660880384b91f7e))
* production hardening, security fixes, and socat SSH relay ([a976869](https://github.com/vineethkrishnan/backupctl/commit/a976869ed369b6ac07e4f9916f9d8810a6153315))


### Bug Fixes

* **ci:** add permissions to commitlint workflow and group dependabot PRs ([ab8efa5](https://github.com/vineethkrishnan/backupctl/commit/ab8efa5d82cc76689eae57bd8dda9b369f7f485c))
* **ci:** move release-please config files to repo root ([1852cfc](https://github.com/vineethkrishnan/backupctl/commit/1852cfcab4440f90ac848a24de45d5f3b20a55b8))
* **ci:** resolve ESLint warnings and correct restic SHA256 checksum ([feda3fa](https://github.com/vineethkrishnan/backupctl/commit/feda3fae6a071f8de1c1cdee40f4c1c1a7baf657))
* **deploy:** multi-stage Dockerfile, NestJS module wiring, install wizard UX ([55325d5](https://github.com/vineethkrishnan/backupctl/commit/55325d5c5aa3cc36b081be59503f608d89ece796))


### Refactoring

* hexagonal architecture, dev environment, and infra improvements ([66c275d](https://github.com/vineethkrishnan/backupctl/commit/66c275d43990def27fd7e6bf40bc562f17636363))


### Documentation

* add VitePress site with Cloudflare Pages deployment ([c20b94f](https://github.com/vineethkrishnan/backupctl/commit/c20b94f07c91248f54a4ce7198ce9674cbfc7ccf))
* **installation:** add full docker-compose.yml to manual setup ([0f4b447](https://github.com/vineethkrishnan/backupctl/commit/0f4b447849dbdfef7ee40696f10e43df28989efe))
* **installation:** add quick install via Docker Hub and remote installer ([d45fb15](https://github.com/vineethkrishnan/backupctl/commit/d45fb1559d3a6fcc8ba283d81700b977ab1e92ab))


### CI/CD

* move deployment workflows to release-only triggers ([0e355a8](https://github.com/vineethkrishnan/backupctl/commit/0e355a8027651839ea6d65a17c73b18ef119c807))
* update action versions and opt into Node.js 24 ([cd59821](https://github.com/vineethkrishnan/backupctl/commit/cd598210a232ec54bf016d99289453e0c2f95a2c))

## [0.1.0] - 2026-03-18

### Added

- Initial release
- Hexagonal architecture with pure domain layer (ports, models, policies)
- Multi-project backup orchestration with 11-step flow
- Database adapters: PostgreSQL, MySQL, MongoDB (always compressed)
- Remote storage via restic to Hetzner Storage Box (SFTP)
- Notification adapters: Slack, Email (SMTP with TLS), Webhook (JSON + markdown)
- GPG encryption for dump files with key management
- Pre/post backup shell hooks
- Automatic retry with exponential backoff (configurable per stage)
- Per-project file-based concurrency lock
- Audit trail in PostgreSQL with JSONL fallback
- Crash recovery on startup (orphan detection, lock cleanup, fallback replay, restic unlock, GPG import)
- Dynamic cron scheduling per project
- 14 CLI commands via nest-commander
- HTTP health and status endpoints
- Restic cache management
- Snapshot tagging (combined/separate modes)
- Dry run mode for backup validation
- Restore with `--decompress` and `--guide` flags
- Timeout alerting (warn without killing)
- Daily summary notifications
- Interactive installation wizard (zero-edit setup)
- Docker + Docker Compose deployment
- Host management scripts (setup, check, deploy, update, logs, shell)
- Comprehensive test suite (342 tests across 46 suites)
- Full documentation suite (setup, configuration, CLI, restore, adapters, troubleshooting)
