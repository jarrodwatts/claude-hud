---
description: Export or import Claude HUD configuration
allowed-tools: Bash, Read, Write, AskUserQuestion
---

# Claude HUD Config Export/Import

## Step 1: Choose Action

Use AskUserQuestion:
- header: "Config Management"
- question: "What would you like to do?"
- options:
  - "Export config" — Copy current config to clipboard or display
  - "Import config" — Paste a config to apply
  - "Reset to defaults" — Clear all custom config

## Export Flow

1. Read `~/.claude/plugins/claude-hud/config.json`
2. Display the JSON content
3. If `pbcopy` available (macOS), offer to copy to clipboard:
   ```bash
   cat ~/.claude/plugins/claude-hud/config.json | pbcopy
   ```
4. Say "Config copied to clipboard!" or display it for manual copy

## Import Flow

1. Use AskUserQuestion to get the JSON string (free text input)
2. Validate it's valid JSON
3. Show preview of what will change
4. Confirm before writing
5. Write to `~/.claude/plugins/claude-hud/config.json`

## Reset Flow

1. Confirm: "This will remove all custom config. The HUD will use default settings. Continue?"
2. If confirmed, delete the config file:
   ```bash
   rm ~/.claude/plugins/claude-hud/config.json
   ```
3. Say "Config reset to defaults. The HUD will use default settings."
