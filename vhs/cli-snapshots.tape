# CLI: snapshots command
# Used in: docs/06-cli-reference.md — snapshots section
# Record: vhs vhs/cli-snapshots.tape

Output docs/assets/cli-snapshots.gif

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
Sleep 500ms
Type "clear"
Enter
Sleep 500ms
Show

Type "backupctl snapshots ayunis-locaboo --last 5"
Enter
Sleep 5s

Sleep 2s
