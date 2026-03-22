# CLI: prune command
# Used in: docs/06-cli-reference.md — prune section
# Record: vhs vhs/cli-prune.tape

Output docs/assets/cli-prune.gif

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

Type "backupctl prune locaboo"
Enter
Sleep 6s

Sleep 2s
