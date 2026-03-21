---
description: Show detailed session statistics and analytics
allowed-tools: Bash, Read, AskUserQuestion
---

# Session Statistics

Display comprehensive statistics for the current session.

## Step 1: Gather Data

Read the following files:
- `~/.claude/plugins/claude-hud/.cache/cache.json` — session stats, burn rate, token analytics, prompt stats
- `~/.claude/plugins/claude-hud/session-history.json` — session history

## Step 2: Parse and Display

Extract from cache.json:
- `session-stats` key → totalToolCalls, totalAgentRuns, peakContextPercent, autocompactCount
- `burn-rate-snapshots` key → current burn rate data
- `token-analytics` key → tool counts and token efficiency
- `prompt-stats` key → prompt count, avg tokens, max tokens
- `alert-history` key → triggered alerts

Format and display:

```
📊 Session Statistics
─────────────────────
⏱  Duration: {from session start}
🔧 Tool calls: {total} (Read: X, Edit: Y, Bash: Z, ...)
🤖 Agent runs: {total}
📈 Peak context: {percent}%
🔄 Autocompacts: {count}

💰 Cost: ${estimated} (burn rate: {tok/m})
📝 Prompts: {count} (avg: {avg}k tok, max: {max}k tok)

⚠  Alerts triggered: {count}
   - {type}: {message} ({time})
   - ...
```

## Step 3: Offer Actions

Use AskUserQuestion:
- header: "Session Stats"
- question: "What would you like to do?"
- options:
  - "Done" — Close stats view
  - "Export as JSON" — Copy raw data to clipboard
  - "Compare with last session" — Show side-by-side comparison
