---
description: Switch Claude HUD color theme
allowed-tools: Read, Write, AskUserQuestion
---

# Switch Color Theme

## Step 1: Show Current Theme

Read `~/.claude/plugins/claude-hud/config.json` and check the `theme` field.

## Step 2: Choose Theme

Use AskUserQuestion:
- header: "Color Theme"
- question: "Choose a color theme (current: {currentTheme})"
- options:
  - "Default" — Standard green/blue/yellow/red
  - "Catppuccin Mocha" — Warm pastel dark theme (#a6e3a1, #89b4fa, #f9e2af, #f38ba8)
  - "Dracula" — Purple-accented dark (#50fa7b, #8be9fd, #f1fa8c, #ff5555)
  - "Nord" — Cool blue-toned (#a3be8c, #81a1c1, #ebcb8b, #bf616a)
  - "Catppuccin Latte" — Light terminal variant (#40a02b, #1e66f5, #df8e1d, #d20f39)
  - "Nord Light" — Light terminal variant (#a3be8c, #5e81ac, #ebcb8b, #bf616a)

## Step 3: Apply

Read existing config, merge in `"theme": "<chosen>"`, write back.

Preserve all other config values.

Say "Theme changed to {name}! The HUD will reflect the change immediately."
