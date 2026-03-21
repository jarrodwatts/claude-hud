---
description: Show differences between current config and defaults
allowed-tools: Bash, Read, AskUserQuestion
---

# Config Diff

Compare your current HUD configuration against defaults.

## Step 1: Read Configs

Read `~/.claude/plugins/claude-hud/config.json` (current config).

## Step 2: Compare with Defaults

For each key that differs from the default, display:

```
Config Diff (current vs default)
────────────────────────────────
  theme:                  "catppuccin"  (default: "default")
  display.barStyle:       "modern"      (default: "classic")
  display.showFrameworks: true          (default: false)
  display.showBurnRate:   true          (default: false)
  display.showCost:       true          (default: false)
  alerts.context.warningThreshold: 60   (default: 70)

  6 differences from default config.
  Unchanged fields not shown.
```

Only show fields that are explicitly set and differ from defaults. Use a recursive comparison for nested objects.

## Step 3: Offer Actions

Use AskUserQuestion:
- header: "Config Diff"
- question: "What would you like to do?"
- options:
  - "Done" — Close
  - "Reset a field to default" — Choose which field to reset
  - "Reset all to defaults" — Clear entire config
