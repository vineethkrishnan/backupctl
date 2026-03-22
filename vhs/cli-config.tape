# CLI: config command
# Used in: docs/06-cli-reference.md — config section
# Record: vhs vhs/cli-config.tape

Output docs/assets/cli-config.gif

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

# Validate config
Type "backupctl config validate"
Enter
Sleep 4s

# Show project config
Type "backupctl config show ayunis-locaboo"
Enter
Sleep 4s

Sleep 2s
