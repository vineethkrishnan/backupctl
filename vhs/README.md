# VHS Terminal Recordings

This directory contains [VHS](https://github.com/charmbracelet/vhs) tape files for recording terminal GIFs used in the README and documentation.

## Prerequisites

- [VHS](https://github.com/charmbracelet/vhs) installed (`brew install vhs` on macOS)
- Dev environment running (`scripts/dev.sh up`)
- At least one project configured in `config/projects.yml` with sample data
- A completed backup in the audit trail (for status, logs, and snapshots GIFs)

## Shared Settings

All tape files use these settings for a consistent look:

```tape
Set Shell "bash"
Set FontSize 14
Set Width 1200
Set Height 600
Set Padding 20
Set TypingSpeed 40ms
Set Theme "Catppuccin Mocha"
Set WindowBar Colorful
```

## Recording

Record a single GIF:

```bash
vhs vhs/hero.tape
vhs vhs/cli-health.tape
```

Record all GIFs at once:

```bash
for tape in vhs/*.tape; do vhs "$tape"; done
```

Output GIFs are written to `docs/assets/`.

## Tape Files

| Tape | Output | Used in |
|------|--------|---------|
| `hero.tape` | `docs/assets/hero.gif` | `README.md` — hero demo |
| `cli-run.tape` | `docs/assets/cli-run.gif` | `docs/06-cli-reference.md` — run section |
| `cli-status.tape` | `docs/assets/cli-status.gif` | `docs/06-cli-reference.md` — status section |
| `cli-health.tape` | `docs/assets/cli-health.gif` | `docs/06-cli-reference.md` — health section |
| `cli-restore.tape` | `docs/assets/cli-restore.gif` | `docs/06-cli-reference.md` — restore section |
| `cli-snapshots.tape` | `docs/assets/cli-snapshots.gif` | `docs/06-cli-reference.md` — snapshots section |
| `cli-prune.tape` | `docs/assets/cli-prune.gif` | `docs/06-cli-reference.md` — prune section |
| `cli-logs.tape` | `docs/assets/cli-logs.gif` | `docs/06-cli-reference.md` — logs section |
| `cli-config.tape` | `docs/assets/cli-config.gif` | `docs/06-cli-reference.md` — config section |
| `cli-cache.tape` | `docs/assets/cli-cache.gif` | `docs/06-cli-reference.md` — cache section |
| `cli-restic.tape` | `docs/assets/cli-restic.gif` | `docs/06-cli-reference.md` — restic section |
| `cli-upgrade.tape` | `docs/assets/cli-upgrade.gif` | `docs/06-cli-reference.md` — upgrade section |

## Re-recording

Re-record GIFs when:

- CLI output format changes
- New commands are added
- The terminal theme or branding is updated

After recording, commit the updated GIFs in `docs/assets/`.

## Customizing

To adjust the look, edit the `Set` directives at the top of each tape file. Common tweaks:

- `Set FontSize` — increase for higher-DPI displays
- `Set Width` / `Set Height` — adjust terminal dimensions
- `Set TypingSpeed` — faster (`20ms`) or slower (`80ms`) typing
- `Set PlaybackSpeed` — speed up (`2`) or slow down (`0.5`) the final GIF
- `Sleep` durations — control how long output stays visible between commands
