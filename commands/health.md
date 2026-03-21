---
description: Run a diagnostic health check on Claude HUD
allowed-tools: Bash, Read, AskUserQuestion
---

# Claude HUD Health Check

Run a comprehensive diagnostic to verify the HUD is working correctly.

## Step 1: Check Plugin Installation

Run:
```bash
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
echo "Plugin cache: $(ls -d "$CLAUDE_DIR/plugins/cache/claude-hud" 2>/dev/null && echo 'YES' || echo 'NO')"
echo "Config file: $(ls "$CLAUDE_DIR/plugins/claude-hud/config.json" 2>/dev/null && echo 'YES' || echo 'NO')"
echo "Cache dir: $(ls -d "$CLAUDE_DIR/plugins/claude-hud/.cache" 2>/dev/null && echo 'YES' || echo 'NO')"
echo "History file: $(ls "$CLAUDE_DIR/plugins/claude-hud/session-history.json" 2>/dev/null && echo 'YES' || echo 'NO')"
echo "Node: $(node --version 2>/dev/null || echo 'NOT FOUND')"
echo "Bun: $(bun --version 2>/dev/null || echo 'NOT FOUND')"
echo "Platform: $(uname -s)"
echo "Terminal: ${COLUMNS:-unknown} cols"
```

## Step 2: Validate Config

Read `~/.claude/plugins/claude-hud/config.json` if it exists.

Check:
- Is it valid JSON?
- Are all field names recognized?
- Is the theme valid (default/catppuccin/dracula/nord)?
- Are threshold values in range (0-100)?

Report any issues found.

## Step 3: Check StatusLine Config

Read `~/.claude/settings.json` and check if `statusLine` is configured.

Report:
- statusLine type and command
- Whether the command path exists

## Step 4: Test HUD Output

Run the statusLine command with sample data:
```bash
echo '{"model":{"display_name":"Test"},"context_window":{"current_usage":{"input_tokens":50000},"context_window_size":200000}}' | <statusLine command> 2>/dev/null
```

Check if output is non-empty.

## Step 5: Report

Present results using AskUserQuestion:
- header: "Health Check Results"
- question: Show all results with ✓/✘ indicators
- options: "Everything looks good!" / "I need help with an issue"

If user needs help, ask what's wrong and debug.
