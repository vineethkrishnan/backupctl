# CLI: logs command
# Used in: docs/06-cli-reference.md — logs section
# Record: vhs vhs/cli-logs.tape

Output docs/assets/cli-logs.gif

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

# Recent logs
Type "backupctl logs ayunis-locaboo --last 5"
Enter
Sleep 4s

# Failed only
Type "backupctl logs ayunis-locaboo --failed"
Enter
Sleep 4s

Sleep 2s
