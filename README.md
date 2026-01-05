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
my-project git:(main) | [Opus 4.5] ████░░░░░░ 19% | 2 CLAUDE.md | 8 rules | 6 MCPs | 6 hooks | ⏱️ 1m
```
- **Project path** — Configurable 1-3 directory levels (default: 1, shown first)
- **Git branch** — Current branch name (configurable on/off)
- **Model** — Current model in use
- **Context bar** — Visual meter with color coding (green → yellow → red as it fills)
- **Config counts** — Rules, MCPs, and hooks loaded
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

Claude HUD can be configured via `~/.claude/plugins/claude-hud/config.json` or by running the interactive CLI:

```bash
npx claude-hud-configure
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `layout` | string | `default` | Layout style: `default`, `condensed`, or `separators` |
| `pathLevels` | 1-3 | 1 | Directory levels to show in project path |
| `gitStatus.enabled` | boolean | true | Show git branch in HUD |
| `gitStatus.showDirty` | boolean | true | Show `*` for uncommitted changes |
| `gitStatus.showAheadBehind` | boolean | false | Show `↑N ↓N` for ahead/behind remote |
| `display.showModel` | boolean | true | Show model name `[Opus]` |
| `display.showContextBar` | boolean | true | Show visual context bar `████░░░░░░` |
| `display.showConfigCounts` | boolean | true | Show CLAUDE.md, rules, MCPs, hooks counts |
| `display.showDuration` | boolean | true | Show session duration `⏱️ 5m` |
| `display.showTokenBreakdown` | boolean | true | Show token details at high context (85%+) |
| `display.showTools` | boolean | true | Show tools activity line |
| `display.showAgents` | boolean | true | Show agents activity line |
| `display.showTodos` | boolean | true | Show todos progress line |

### Layout Options

**Default layout** — Everything on first line:
```
my-project git:(main) | [Opus] ████░░░░░░ 42% | 2 rules | ⏱️ 5m
✓ Read ×3 | ✓ Edit ×1
```

**Condensed layout** — Model/context on top, project on bottom:
```
[Opus] ████░░░░░░ 42% | ⏱️ 5m
✓ Read ×3 | ✓ Edit ×1
my-project git:(main) | 2 rules
```

**Separators layout** — Condensed with visual separators:
```
[Opus] ████░░░░░░ 42% | ⏱️ 5m
──────────────────────────────────────────────────
✓ Read ×3 | ✓ Edit ×1
──────────────────────────────────────────────────
my-project git:(main) | 2 rules
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
    "showTokenBreakdown": true,
    "showTools": true,
    "showAgents": true,
    "showTodos": true
  }
}
```

### Display Examples

**1 level (default):** `my-project git:(main) | [Opus] ...`

**2 levels:** `apps/my-project git:(main) | [Opus] ...`

**3 levels:** `dev/apps/my-project git:(main) | [Opus] ...`

**With dirty indicator:** `my-project git:(main*) | [Opus] ...`

**With ahead/behind:** `my-project git:(main ↑2 ↓1) | [Opus] ...`

**Minimal display (only context %):** Configure `showModel`, `showContextBar`, `showConfigCounts`, `showDuration` to `false`

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