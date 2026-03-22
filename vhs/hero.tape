# Hero GIF — backup-restore lifecycle demo
# Used in: README.md
# Record: vhs vhs/hero.tape

Output docs/assets/hero.gif

Require docker

Set Shell "bash"
Set FontSize 14
Set Width 1200
Set Height 600
Set Padding 20
Set TypingSpeed 40ms
Set Theme "Catppuccin Mocha"
Set WindowBar Colorful

# Set up clean alias (hidden from recording)
Hide
Type "alias backupctl='docker exec backupctl-dev npx ts-node -r tsconfig-paths/register src/cli.ts'"
Enter
Sleep 500ms
Type "clear"
Enter
Sleep 500ms
Show

# Health check
Type "backupctl health"
Enter
Sleep 5s

# Dry run
Type "backupctl run ayunis-locaboo --dry-run"
Enter
Sleep 6s

# Real backup
Type "backupctl run ayunis-locaboo"
Enter
Sleep 10s

# List snapshots
Type "backupctl snapshots ayunis-locaboo --last 3"
Enter
Sleep 5s

# Restore guide
Type "backupctl restore ayunis-locaboo latest /tmp/restore --guide"
Enter
Sleep 6s

Sleep 2s
