---
layout: home

hero:
  name: backupctl
  text: Backup orchestration for databases, files, or both
  tagline: Database-agnostic, hexagonal architecture, CLI-first. Manage PostgreSQL, MySQL, and MongoDB backups from a single Docker container.
  actions:
    - theme: brand
      text: Get Started
      link: /01-introduction
    - theme: alt
      text: CLI Reference
      link: /06-cli-reference
    - theme: alt
      text: GitHub
      link: https://github.com/vineethkrishnan/backupctl

features:
  - icon: "🗄️"
    title: Multi-Database Support
    details: PostgreSQL, MySQL, and MongoDB out of the box with a pluggable adapter pattern for adding new database types.
  - icon: "🔐"
    title: Encrypted & Deduplicated
    details: Restic remote storage with built-in encryption and deduplication. Optional GPG layer for dump files before sync.
  - icon: "📋"
    title: Full Audit Trail
    details: Every backup tracked in PostgreSQL with real-time stage progress. JSONL fallback ensures no result is ever lost.
  - icon: "🔄"
    title: Crash Recovery
    details: Automatic startup recovery — orphan cleanup, stale lock removal, restic unlock, fallback replay, GPG key import.
  - icon: "⚡"
    title: 14 CLI Commands
    details: "run, status, health, restore, snapshots, prune, logs, config, cache, restic — all with structured exit codes."
  - icon: "🏗️"
    title: Hexagonal Architecture
    details: Pure domain layer with zero framework dependencies. Ports and adapters for clean, testable, extensible design.
---
