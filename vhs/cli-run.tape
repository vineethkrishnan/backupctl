# CLI: run command
# Used in: docs/06-cli-reference.md — run section
# Record: vhs vhs/cli-run.tape

Output docs/assets/cli-run.gif

Require docker

Set Shell "bash"
Set FontSize 14
Set Width 1200
Set Height 600
Set Padding 20
Set TypingSpeed 40ms
Set Theme "Catppuccin Mocha"
Set WindowBar Colorful

Hide
Type "alias backupctl='docker exec backupctl-dev npx ts-node -r tsconfig-paths/register src/cli.ts'"
Enter
Sleep 1s
Show

# Dry run first
Type "backupctl run locaboo --dry-run"
Enter
Sleep 6s

# Real backup
Type "backupctl run locaboo"
Enter
Sleep 10s

Sleep 2s
