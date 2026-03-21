---
description: Manage HUD config presets (save, load, share)
allowed-tools: Bash, Read, Write, AskUserQuestion
---

# Config Presets

## Step 1: Choose Action

Use AskUserQuestion:
- header: "Config Presets"
- question: "What would you like to do?"
- options:
  - "Save current config as preset" — Save with a name
  - "Load a preset" — Apply a saved preset
  - "List presets" — Show all saved presets
  - "Delete a preset" — Remove a saved preset
  - "Import preset from JSON" — Paste JSON to import

## Save Flow
1. Ask for preset name (AskUserQuestion, free text)
2. Ask for description (AskUserQuestion, free text)
3. Read current `~/.claude/plugins/claude-hud/config.json`
4. Save to presets.json
5. Confirm: "Preset '{name}' saved!"

## Load Flow
1. Read presets.json, list available presets
2. AskUserQuestion with preset names as options
3. Read selected preset, write to config.json (merge preserving schemaVersion)
4. Confirm: "Preset '{name}' applied! HUD will update immediately."

## List Flow
1. Read presets.json, display each with name, description, created date

## Delete Flow
1. List presets, ask which to delete
2. Confirm deletion
3. Remove from presets.json

## Import Flow
1. AskUserQuestion for JSON input (free text)
2. Parse and validate
3. Save as new preset
