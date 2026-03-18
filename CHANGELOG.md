# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
