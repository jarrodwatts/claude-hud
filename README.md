# Claude HUD

A Claude Code plugin that shows what's happening — context usage, active tools, running agents, and todo progress. Always visible below your input.

[![License](https://img.shields.io/github/license/jarrodwatts/claude-hud?v=2)](LICENSE)
[![Stars](https://img.shields.io/github/stars/jarrodwatts/claude-hud)](https://github.com/jarrodwatts/claude-hud/stargazers)

![Claude HUD in action](claude-hud-preview-5-2.png)

## Install

Inside a Claude Code instance, run the following commands:

**Step 1: Add the marketplace**
```
/plugin marketplace add jarrodwatts/claude-hud
```

**Step 2: Install the plugin**
```
/plugin install claude-hud
```

**Step 3: Configure the statusline**
```
/claude-hud:setup
```

Done! The HUD appears immediately — no restart needed.

---

## What is Claude HUD?

Claude HUD gives you better insights into what's happening in your Claude Code session.

| What You See | Why It Matters |
|--------------|----------------|
| **Project path** | Know which project you're in (configurable 1-3 directory levels) |
| **Context health** | Know exactly how full your context window is before it's too late |
| **Tool activity** | Watch Claude read, edit, and search files as it happens |
| **Agent tracking** | See which subagents are running and what they're doing |
| **Todo progress** | Track task completion in real-time |

## What Each Line Shows

### Session Info
```
[Opus | Pro] █████░░░░░ 45% | my-project git:(main) | 2 CLAUDE.md | 5h: 25% | ⏱️ 5m
```
- **Model** — Current model in use (shown first)
- **Plan name** — Your subscription tier (Pro, Max, Team) when usage enabled
- **Context bar** — Visual meter with color coding (green → yellow → red as it fills)
- **Project path** — Configurable 1-3 directory levels (default: 1)
- **Git branch** — Current branch name (configurable on/off)
- **Config counts** — CLAUDE.md files, rules, MCPs, and hooks loaded
- **Usage limits** — 5-hour rate limit percentage (opt-in, Pro/Max/Team only)
- **Duration** — How long the session has been running

### Tool Activity
```
✓ TaskOutput ×2 | ✓ mcp_context7 ×1 | ✓ Glob ×1 | ✓ Skill ×1
```
- **Running tools** show a spinner with the target file
- **Completed tools** aggregate by type with counts

### Agent Status
```
✓ Explore: Explore home directory structure (5s)
✓ open-source-librarian: Research React hooks patterns (2s)
```
- **Agent type** and what it's working on
- **Elapsed time** for each agent

### Todo Progress
```
✓ All todos complete (5/5)
```
- **Current task** or completion status
- **Progress counter** (completed/total)

---

## How It Works

Claude HUD uses Claude Code's native **statusline API** — no separate window, no tmux required, works in any terminal.

```
Claude Code → stdin JSON → claude-hud → stdout → displayed in your terminal
           ↘ transcript JSONL (tools, agents, todos)
```

**Key features:**
- Native token data from Claude Code (not estimated)
- Parses the transcript for tool/agent activity
- Updates every ~300ms

---

## Configuration

Customize your HUD anytime:

```
/claude-hud:configure
```

The guided flow walks you through customization — no manual editing needed:

- **First time setup**: Choose a preset (Full/Essential/Minimal), then fine-tune individual elements
- **Customize anytime**: Toggle items on/off, adjust git display style, switch layouts
- **Preview before saving**: See exactly how your HUD will look before committing changes

### Presets

| Preset | What's Shown |
|--------|--------------|
| **Full** | Everything enabled — tools, agents, todos, git, usage, duration |
| **Essential** | Activity lines + git status, minimal info clutter |
| **Minimal** | Core only — just model name and context bar |

After choosing a preset, you can turn individual elements on or off.

### Manual Configuration

You can also edit the config file directly at `~/.claude/plugins/claude-hud/config.json`.

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `layout` | string | `default` | Layout style: `default` or `separators` |
| `pathLevels` | 1-3 | 1 | Directory levels to show in project path |
| `gitStatus.enabled` | boolean | true | Show git branch in HUD |
| `gitStatus.showDirty` | boolean | true | Show `*` for uncommitted changes |
| `gitStatus.showAheadBehind` | boolean | false | Show `↑N ↓N` for ahead/behind remote |
| `display.showModel` | boolean | true | Show model name `[Opus]` |
| `display.showContextBar` | boolean | true | Show visual context bar `████░░░░░░` |
| `display.showConfigCounts` | boolean | true | Show CLAUDE.md, rules, MCPs, hooks counts |
| `display.showDuration` | boolean | true | Show session duration `⏱️ 5m` |
| `display.showUsage` | boolean | true | Show usage limits (Pro/Max/Team only) |
| `display.showTokenBreakdown` | boolean | true | Show token details at high context (85%+) |
| `display.showTools` | boolean | true | Show tools activity line |
| `display.showAgents` | boolean | true | Show agents activity line |
| `display.showTodos` | boolean | true | Show todos progress line |

### Usage Limits (Pro/Max/Team)

Usage display is **enabled by default** for Claude Pro, Max, and Team subscribers. It shows your rate limit consumption directly in the HUD.

When enabled, you'll see your 5-hour usage percentage. The 7-day percentage appears when above 80%:

```
[Opus | Pro] █████░░░░░ 45% | my-project | 5h: 25% | 7d: 85%
```

To disable usage display, set `display.showUsage` to `false` in your config.

**Requirements:**
- Claude Pro, Max, or Team subscription (not available for API users)
- OAuth credentials from Claude Code (created automatically when you log in)

**Troubleshooting:** If usage doesn't appear:
- Ensure you're logged in with a Pro/Max/Team account (not API key)
- Check `display.showUsage` is not set to `false` in config
- API users see no usage display (they have pay-per-token, not rate limits)

### Layout Options

**Default layout** — All info on first line:
```
[Opus] ████░░░░░░ 42% | my-project git:(main) | 2 rules | ⏱️ 5m
✓ Read ×3 | ✓ Edit ×1
```

**Separators layout** — Visual separator below header when activity exists:
```
[Opus] ████░░░░░░ 42% | my-project git:(main) | 2 rules | ⏱️ 5m
──────────────────────────────────────────────────────────────
✓ Read ×3 | ✓ Edit ×1
```

### Example Configuration

```json
{
  "layout": "default",
  "pathLevels": 2,
  "gitStatus": {
    "enabled": true,
    "showDirty": true,
    "showAheadBehind": true
  },
  "display": {
    "showModel": true,
    "showContextBar": true,
    "showConfigCounts": true,
    "showDuration": true,
    "showUsage": true,
    "showTokenBreakdown": true,
    "showTools": true,
    "showAgents": true,
    "showTodos": true
  }
}
```

### Display Examples

**1 level (default):** `[Opus] 45% | my-project git:(main) | ...`

**2 levels:** `[Opus] 45% | apps/my-project git:(main) | ...`

**3 levels:** `[Opus] 45% | dev/apps/my-project git:(main) | ...`

**With dirty indicator:** `[Opus] 45% | my-project git:(main*) | ...`

**With ahead/behind:** `[Opus] 45% | my-project git:(main ↑2 ↓1) | ...`

**Minimal display (only context %):** Configure `showModel`, `showContextBar`, `showConfigCounts`, `showDuration` to `false`

### Troubleshooting

**Config not applying?**
- Check for JSON syntax errors: invalid JSON silently falls back to defaults
- Ensure valid values: `pathLevels` must be 1, 2, or 3; `layout` must be `default` or `separators`
- Delete config and run `/claude-hud:configure` to regenerate

**Git status missing?**
- Verify you're in a git repository
- Check `gitStatus.enabled` is not `false` in config

**Tool/agent/todo lines missing?**
- These only appear when there's activity to show
- Check `display.showTools`, `display.showAgents`, `display.showTodos` in config

---

## Requirements

- Claude Code v1.0.80+
- Node.js 18+ or Bun

---

## Development

```bash
git clone https://github.com/jarrodwatts/claude-hud
cd claude-hud
npm ci && npm run build
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

MIT — see [LICENSE](LICENSE)