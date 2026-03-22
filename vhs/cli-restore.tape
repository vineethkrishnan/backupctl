# CLI: restore command
# Used in: docs/06-cli-reference.md — restore section
# Record: vhs vhs/cli-restore.tape

Output docs/assets/cli-restore.gif

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

# Show restore guide
Type "backupctl restore locaboo latest /tmp/restore --guide"
Enter
Sleep 6s

Sleep 2s
