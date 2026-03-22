# CLI: status command
# Used in: docs/06-cli-reference.md — status section
# Record: vhs vhs/cli-status.tape

Output docs/assets/cli-status.gif

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

# All projects status
Type "backupctl status"
Enter
Sleep 4s

# Single project with history
Type "backupctl status locaboo --last 3"
Enter
Sleep 4s

Sleep 2s
