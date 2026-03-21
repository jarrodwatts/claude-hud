---
description: Check for claude-hud updates
allowed-tools: Bash, AskUserQuestion
---

# Check for Updates

## Step 1: Get Current and Latest Version

Run:
```bash
CURRENT=$(node -e "console.log(require('./package.json').version)" 2>/dev/null || echo "unknown")
LATEST=$(npm view @sooneocean/claude-hud version 2>/dev/null || echo "unknown")
echo "Current: $CURRENT"
echo "Latest: $LATEST"
```

## Step 2: Compare

If versions match:
> "You're on the latest version (v{version}). No update needed."

If latest is newer:

Use AskUserQuestion:
- header: "Update Available"
- question: "New version available: v{current} → v{latest}. Update now?"
- options:
  - "Update" — Install the latest version
  - "Skip" — Stay on current version
  - "View changelog" — Show what's new

If "Update":
```bash
npm install -g @sooneocean/claude-hud@latest
```

If "View changelog":
Read CHANGELOG.md and display the relevant section.
