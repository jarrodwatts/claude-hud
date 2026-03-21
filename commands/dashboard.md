---
description: Export session dashboard as JSON
allowed-tools: Bash, Read, AskUserQuestion
---

# Export Session Dashboard

## Step 1: Choose Format

Use AskUserQuestion:
- header: "Dashboard Export"
- question: "How would you like to export your session data?"
- options:
  - "Display here" — Show JSON in terminal
  - "Copy to clipboard" — Copy JSON to clipboard (macOS)
  - "Save to file" — Save to a JSON file

## Step 2: Execute

Run the appropriate command based on choice.

For "Display here":
```bash
cat ~/.claude/plugins/claude-hud/session-history.json 2>/dev/null || echo "No session history yet"
```

For "Copy to clipboard" (macOS):
```bash
cat ~/.claude/plugins/claude-hud/session-history.json | pbcopy && echo "Copied to clipboard!"
```

For "Save to file":
Ask user for file path, then:
```bash
cp ~/.claude/plugins/claude-hud/session-history.json <path>
```
