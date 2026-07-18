# Storage backend drill screenshots

Terminal output captured during the end-to-end backup and restore drill documented in
[`docs/18-storage-backend-drill.md`](../../../18-storage-backend-drill.md).

Each `NN-name.txt` holds the captured terminal text; the matching `NN-name.png` is its
rendered image. After editing any `.txt`, regenerate with:

```bash
docs/public/images/storage-backend-drill/render.sh
```

Always use the script rather than calling `freeze` by hand. It renders every capture with
identical settings and prints the resulting dimensions so a width regression is obvious.

## Conventions

- **Every image must be the same pixel width.** VitePress fits each image to the content
  column, so on-page text size is inversely proportional to an image's pixel width. Mixing
  widths makes narrow captures render with huge text and wide ones with tiny text. The
  script pins the width by padding the first line to `COLUMNS` characters.
- `COLUMNS` is 120, the smallest budget that fits the widest capture (118 characters)
  without wrapping. Wrapping tighter than the content splits table rows mid-value. If you
  add a capture wider than 120 characters, either shorten it or raise `COLUMNS` and
  re-render everything so the set stays uniform.
- freeze's `--width` flag does not solve this: it widens the canvas without scaling the
  font, which shrinks the text rather than keeping it consistent.
- Rendered with [freeze](https://github.com/charmbracelet/freeze), always with `--window`.
  The older `docs/public/images/helpcenter/` set predates this and used silicon.
- `--font.family` is not usable: freeze v0.2.2 renders a blank image for any font other
  than its embedded default. Leave the font unset.
- The embedded font has no glyph for `✅` (U+2705) or `❌` (U+274C) — both render as tofu
  boxes. The CLI emits those characters, but the captures here substitute `✓` (U+2713)
  and `✗` (U+2717) so the pass/fail signal stays legible. This is the only way these
  captures differ from raw CLI output.

## Provenance

Captured against PostgreSQL 17 with restic 0.18.1 and rclone v1.69.3. Project names read
`drill-*` because that is what the drill actually ran; they are not a naming convention.
`backupctl_drill` was a throwaway database seeded with adversarial fixture data, dropped
after the drill.

| File | Shows |
|------|-------|
| `01-config-validate.txt/png` | `config validate` passing for all backends |
| `02-repo-init.txt/png` | One-time `restic init` via the CLI passthrough |
| `03-dry-run.txt/png` | `run --dry-run` preflight, all six checks green |
| `04-run-backup.txt/png` | A real backup: dump, encrypt, verify, snapshot |
| `05-snapshots.txt/png` | `snapshots` listing with project/timestamp/db tags |
| `06-status.txt/png` | `status` across four backends |
| `07-restore-guide.txt/png` | `restore --guide` config-aware instructions |
| `08-restore-decrypt.txt/png` | Restore, GPG decrypt, `PGDMP` header check |
| `09-fidelity-check.txt/png` | Original vs restored md5 fingerprints |
| `10-lock-collision.txt/png` | Concurrent run rejected with exit code 2 |
