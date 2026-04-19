# Help Center

Step-by-step playbooks for recurring issues we've hit in production. Unlike the [Troubleshooting](../12-troubleshooting) reference — which is a flat list of symptoms → fixes — each help center article walks through **diagnosis, short-term workaround, and permanent fix** for one specific class of problem, with terminal screenshots so you know what to expect at each step.

## When to use which page

| Page | Use it when… |
|------|--------------|
| [Help Center](./) (you are here) | You've hit an issue before and want a guided, repeatable runbook |
| [Troubleshooting](../12-troubleshooting) | You want a quick symptom/fix lookup |
| [FAQ](../15-faq) | You're setting something up for the first time |

## Articles

| # | Article | Symptom |
|---|---------|---------|
| 1 | [pg_dump / mysqldump times out on large databases](./01-dump-command-timeout) | `Command "pg_dump" failed` after ~5 minutes on DBs larger than a few GB |
| 2 | [Docker network connect fails on `backupctl` startup or backup run](./02-docker-network-connect) | `network … not found`, `permission denied while trying to connect to the Docker daemon`, or database host unreachable |

## Anatomy of an article

Every help center article follows the same shape so you can scan straight to what you need:

1. **Symptom** — the exact error string you'll see in logs or terminal
2. **Who this affects** — the environments / configurations where it shows up
3. **Root cause** — one-paragraph explanation of *why* it happens
4. **Diagnose** — commands to run to confirm it's this issue and not something else
5. **Short-term workaround** — the "get-unblocked-right-now" fix
6. **Permanent fix** — the upgrade / config change that removes the problem for good
7. **Prevent recurrence** — monitoring / config to catch it earlier next time

## Contributing a new article

If you hit an issue in production, resolve it, and the fix isn't obvious from the existing docs — add an article here. Follow the shape above, put any terminal screenshots under `docs/public/images/helpcenter/` as `NN-short-name.png`, and link it from the table on this page.

See [Generating screenshots](#generating-screenshots) below for the `silicon` command conventions we use.

## Generating screenshots

All terminal screenshots in this section are generated with [silicon](https://github.com/Aloxaf/silicon) from a `.txt` capture of the real terminal output, so the styling stays consistent.

```bash
# Capture terminal output to a file
backupctl run ayunis-core-production > capture.txt 2>&1

# Render with silicon (one-shot install: brew install silicon)
silicon capture.txt \
  --output docs/public/images/helpcenter/01-pg-dump-timeout.png \
  --language console \
  --theme "Dracula" \
  --font "JetBrains Mono=14" \
  --background "#1e1e2e" \
  --pad-horiz 24 --pad-vert 24 \
  --no-window-controls
```

The `console` language highlights `$`-prefixed commands and leaves plain output untouched — matches the style of screenshots in the rest of the docs.
