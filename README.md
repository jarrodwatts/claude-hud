# Claude HUD

A Claude Code plugin that shows what's happening — context usage, active tools, running agents, and todo progress. Always visible below your input.

[![License](https://img.shields.io/github/license/jarrodwatts/claude-hud?v=2)](LICENSE)
[![Stars](https://img.shields.io/github/stars/jarrodwatts/claude-hud)](https://github.com/jarrodwatts/claude-hud/stargazers)

![Claude HUD in action](claude-hud-preview-5-2.png)

> 🌐 English | [中文文档](README.zh.md)

## Install

Inside a Claude Code instance, run the following commands:

**Step 1: Add the marketplace**
```
/plugin marketplace add jarrodwatts/claude-hud
```

**Step 2: Install the plugin**

<details>
<summary><strong>⚠️ Linux users: Click here first</strong></summary>

On Linux, `/tmp` is often a separate filesystem (tmpfs), which causes plugin installation to fail with:
```
EXDEV: cross-device link not permitted
```

**Fix**: Set TMPDIR before installing:
```bash
mkdir -p ~/.cache/tmp && TMPDIR=~/.cache/tmp claude
```

Then run the install command below in that session. This is a [Claude Code platform limitation](https://github.com/anthropics/claude-code/issues/14799).

</details>

```
/plugin install claude-hud
```

After that, reload plugins:

```
/reload-plugins
```


**Step 3: Configure the statusline**
```
/claude-hud:setup
```

<details>
<summary><strong>⚠️ Windows users: Click here if setup says no JavaScript runtime was found</strong></summary>

On Windows, Node.js LTS is the supported runtime for Claude HUD setup. If setup says no JavaScript runtime was found, install Node.js for your shell first:
```powershell
winget install OpenJS.NodeJS.LTS
```
Then restart your shell and run `/claude-hud:setup` again.

</details>

Done! Restart Claude Code to load the new statusLine config, then the HUD will appear.

On Windows, make that a full Claude Code restart after setup writes the new `statusLine` config.

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

## What You See

### Default (2 lines)
```
[Opus] │ my-project git:(main*)
Context █████░░░░░ 45% │ Usage ██░░░░░░░░ 25% (1h 30m / 5h)
```
- **Line 1** — Model, provider label when positively identified (for example `Bedrock`, `Vertex`), project path, git branch
- **Line 2** — Context bar (green → yellow → red) and usage rate limits

### Optional lines (enable via `/claude-hud:configure`)
```
◐ Edit: auth.ts | ✓ Read ×3 | ✓ Grep ×2        ← Tools activity
◐ explore [haiku]: Finding auth code (2m 15s)    ← Agent status
▸ Fix authentication bug (2/5)                   ← Todo progress
```

---

## How It Works

Claude HUD uses Claude Code's native **statusline API** — no separate window, no tmux required, works in any terminal.

```
Claude Code → stdin JSON → claude-hud → stdout → displayed in your terminal
           ↘ transcript JSONL (tools, agents, todos)
```

**Key features:**
- Native token data from Claude Code (not estimated)
- Scales with Claude Code's reported context window size, including newer 1M-context sessions
- Parses the transcript for tool/agent activity
- Updates every ~300ms

---

## Configuration

Customize your HUD anytime:

```
/claude-hud:configure
```

The guided flow handles layout, language, and common display toggles. Advanced overrides such as
custom colors and thresholds are preserved there, but you set them by editing the config file directly:

- **First time setup**: Choose a preset (Full/Essential/Minimal), pick a label language, then fine-tune individual elements
- **Customize anytime**: Toggle items on/off, adjust git display style, switch layouts, or change label language
- **Preview before saving**: See exactly how your HUD will look before committing changes

### Presets

| Preset | What's Shown |
|--------|--------------|
| **Full** | Everything enabled — tools, agents, todos, git, usage, duration |
| **Essential** | Activity lines + git status, minimal info clutter |
| **Minimal** | Core only — just model name and context bar |

After choosing a preset, you can turn individual elements on or off.

### Manual Configuration

Edit `~/.claude/plugins/claude-hud/config.json` directly for advanced settings such as `colors.*`,
`pathLevels`, `maxWidth`, threshold overrides, `display.timeFormat`, and `display.promptCacheTtlSeconds`. Running `/claude-hud:configure`
preserves those manual settings while still letting you change `language`, layout, and the common
guided toggles.

Chinese HUD labels are available as an explicit opt-in. English stays the default unless you choose `中文` in `/claude-hud:configure` or set `language` in config. The short `zh` alias remains valid, and new guided config writes the canonical `zh-Hans` value.

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `language` | `en` \| `zh` \| `zh-Hans` | `en` | HUD label language. English is the default; set `zh` or `zh-Hans` to enable Simplified Chinese labels. |
| `lineLayout` | string | `expanded` | Layout: `expanded` (multi-line) or `compact` (single line) |
| `pathLevels` | 1-3 | 1 | Directory levels to show in project path |
| `maxWidth` | number \| `null` | `null` | Optional fallback width used only when terminal width detection fails completely |
| `forceMaxWidth` | boolean | false | Always use `maxWidth` when it is set, even if terminal width detection returns a smaller value |
| `elementOrder` | string[] | `["project","addedDirs","context","usage","promptCache","memory","environment","tools","skills","mcp","agents","todos","sessionTime"]` | Expanded-mode element order. Omit entries to hide them in expanded mode. Existing configs keep their explicit order until updated. |
| `display.mergeGroups` | string[][] | `[["context","usage"]]` | Expanded-mode groups that should share a line when adjacent. Set `[]` to disable merged lines. |
| `gitStatus.enabled` | boolean | true | Show git branch in HUD |
| `gitStatus.showDirty` | boolean | true | Show `*` for uncommitted changes |
| `gitStatus.showAheadBehind` | boolean | false | Show `↑N ↓N` for ahead/behind remote |
| `gitStatus.pushWarningThreshold` | number | 0 | Color the ahead count with the warning color at or above this unpushed-commit count (`0` disables it) |
| `gitStatus.pushCriticalThreshold` | number | 0 | Color the ahead count with the critical color at or above this unpushed-commit count (`0` disables it) |
| `gitStatus.showFileStats` | boolean | false | Show file change counts `!M +A ✘D ?U` |
| `gitStatus.branchOverflow` | `truncate` \| `wrap` | `truncate` | Keep current truncation behavior or let the git block wrap onto its own line boundary when possible |
| `display.showModel` | boolean | true | Show model name `[Opus]` |
| `display.showProvider` | boolean | false | Show the provider label *before* the model name, e.g. `[Bedrock \| Opus 4.6]`. Useful when a custom proxy serves identically-named models from different providers. When off, an auto-detected provider still trails the model as before |
| `display.providerName` | string | `""` | Explicit provider label used with `display.showProvider`, e.g. for a custom proxy that can't be auto-detected. Falls back to the auto-detected provider (Bedrock/Vertex/Enterprise) when empty; capped at 40 chars |
| `display.showAddedDirs` | boolean | true | Show extra workspace directories from `/add-dir` (e.g. `+sparkle +lib-foo`); empty array renders nothing. In both layouts at most 5 dirs render (overflow shown as `+N more`) and basenames are truncated to 24 chars with `…` |
| `display.addedDirsLayout` | `inline` \| `line` | `inline` | `inline` puts dirs next to the project name with a `+name` prefix per dir; `line` renders them on a separate `Added dirs: name1, name2` line (no `+` prefix, comma-separated) |
| `display.showContextBar` | boolean | true | Show visual context bar `████░░░░░░` |
| `display.contextValue` | `percent` \| `tokens` \| `remaining` \| `both` | `percent` | Context display format (`45%`, `45k/200k`, `55%` remaining, or `45% (45k/200k)`) |
| `display.autoCompactWindow` | number \| `null` | `null` | When set to a positive number such as `200000`, compute the context percentage against this auto-compact window instead of the full model context window, matching the `/context` figure. Leave unset or `null` to preserve default full-window behavior. |
| `display.showConfigCounts` | boolean | false | Show CLAUDE.md, rules, MCPs, hooks counts |
| `display.showCost` | boolean | false | Show session cost using Claude Code's native `cost.total_cost_usd` when available, with a local estimate fallback for direct Anthropic sessions |
| `display.showRoutedCost` | boolean | false | Also show cost for routed providers (Bedrock/Vertex), which `showCost` hides by default. Requires `showCost` too. Uses the native `cost.total_cost_usd` when positive (`Cost`), otherwise the token estimate (`Est.`) |
| `display.showOutputStyle` | boolean | false | Show the active Claude Code `outputStyle` from settings files as `style: <name>` |
| `display.showDuration` | boolean | false | Show session duration `⏱️ 5m` |
| `display.showSpeed` | boolean | false | Show output token speed `out: 42.1 tok/s` |
| `display.showUsage` | boolean | true | Show Claude subscriber usage limits when available |
| `display.usageValue` | `percent` \| `remaining` | `percent` | Usage display format (`25%` used, or `75%` remaining) |
| `display.usageBarEnabled` | boolean | true | Display usage as visual bar instead of text |
| `display.usageCompact` | boolean | false | Display usage in a shorter text form such as `5h: 25% (1h 30m)`; takes precedence over `display.usageBarEnabled` |
| `display.showResetLabel` | boolean | true | Show the `resets in` prefix before usage countdowns |
| `display.timeFormat` | `relative` \| `absolute` \| `both` \| `elapsed` \| `elapsedAndAbsolute` | `relative` | How usage-window time is shown: countdown only (`resets in 2h 30m`), wall-clock reset (`resets at 14:30`), both, elapsed window percentage (`53% elapsed`), or elapsed plus wall-clock reset |
| `display.sevenDayThreshold` | 0-100 | 80 | Show 7-day usage when >= threshold (0 = always) |
| `display.externalUsagePath` | string | `""` | Optional absolute path to a local usage snapshot file. Relative paths are ignored. When stdin `rate_limits` are present, only `balance_label` is appended; when they are missing, valid usage windows can be used as a fallback |
| `display.externalUsageWritePath` | string | `""` | Optional absolute `.json` path in an existing directory. When stdin `rate_limits` exists, ClaudeHUD writes a private snapshot for other local tools. Relative paths, non-json files, and missing parent directories are ignored |
| `display.externalUsageFreshnessMs` | number | `300000` | Maximum allowed age for the external usage snapshot before it is ignored |
| `display.showTokenBreakdown` | boolean | true | Show token details at high context (85%+) |
| `display.showTools` | boolean | false | Show tools activity line |
| `display.showSkills` | boolean | false | Show active Skills detected from `Skill` tool invocations |
| `display.showMcp` | boolean | false | Show active MCP servers detected from `mcp__server__tool` invocations |
| `display.toolNameMaxLength` | number | `0` | Maximum displayed tool-name length. `0` keeps full names; MCP names may shorten to their final segment when truncating |
| `display.toolsMaxVisible` | number | `4` | Maximum completed tools shown on the tools line. `0` means unlimited |
| `display.showAgents` | boolean | false | Show agents activity line |
| `display.showTodos` | boolean | false | Show todos progress line |
| `display.showSessionName` | boolean | false | Show session slug or custom title from `/rename` |
| `display.showAdvisor` | boolean | false | Inline the model configured via Claude Code's `/advisor` on the project line, e.g. `Advisor: Opus 4.7`. Read from the `advisorModel` field that Claude Code stamps on each assistant transcript record; sanitised and capped at 64 chars before rendering |
| `display.advisorOverride` | string | `""` | Optional manual override for the displayed advisor label. When non-empty, replaces transcript-driven detection. Also sanitised and capped at 64 chars |
| `display.showSessionStartDate` | boolean | false | Show the transcript session start timestamp |
| `display.showLastResponseAt` | boolean | false | Show how long ago the last assistant response was written |
| `display.showCompactions` | boolean | false | Show how many context compactions (manual `/compact` or auto) have occurred this session, counted from transcript `compact_boundary` entries, e.g. `Compactions: 2`. Hidden until the first compaction |
| `display.showClaudeCodeVersion` | boolean | false | Show the installed Claude Code version, e.g. `CC v2.1.81` |
| `display.showMemoryUsage` | boolean | false | Show an approximate system RAM usage line in expanded layout |
| `display.showPromptCache` | boolean | false | Show a prompt cache countdown based on the last assistant response timestamp in the transcript |
| `display.promptCacheTtlSeconds` | number | `300` | Prompt cache TTL in seconds. Keep the default for Pro, set `3600` for Max |
| `colors.context` | color value | `green` | Base color for the context bar and context percentage |
| `colors.usage` | color value | `brightBlue` | Base color for usage bars and percentages below warning thresholds |
| `colors.warning` | color value | `yellow` | Warning color for context thresholds and usage warning text |
| `colors.usageWarning` | color value | `brightMagenta` | Warning color for usage bars and percentages near their threshold |
| `colors.critical` | color value | `red` | Critical color for limit-reached states and critical thresholds |
| `colors.model` | color value | `cyan` | Color for the model badge such as `[Opus]` |
| `colors.project` | color value | `yellow` | Color for the project path |
| `colors.git` | color value | `magenta` | Color for git wrapper text such as `git:(` and `)` |
| `colors.gitBranch` | color value | `cyan` | Color for the git branch and branch status text |
| `colors.label` | color value | `dim` | Color for labels and secondary metadata such as `Context`, `Usage`, counts, and progress text |
| `colors.custom` | color value | `208` | Color for the optional custom line |
| `colors.barFilled` | string | `█` | Character used for the filled portion of progress bars |
| `colors.barEmpty` | string | `░` | Character used for the empty portion of progress bars |

`colors.barFilled` and `colors.barEmpty` accept a single visible grapheme. Control characters, invisible format characters (bidi controls, zero-width joiners, variation selectors), line/paragraph separators, and noncharacters are rejected. Wide characters (emoji, CJK) may affect bar alignment depending on the terminal.

Supported color names: `dim`, `red`, `green`, `yellow`, `magenta`, `cyan`, `brightBlue`, `brightMagenta`. You can also use a 256-color number (`0-255`) or hex (`#rrggbb`).

`display.showMemoryUsage` is fully opt-in and only renders in `expanded` layout. It reports approximate system RAM usage from the local machine, not precise memory pressure inside Claude Code or a specific process. The number may overstate actual pressure because reclaimable OS cache and buffers can still be counted as used memory.

`display.showCost` is fully opt-in. ClaudeHUD prefers the native `cost.total_cost_usd` field that Claude Code provides on stdin when it is available. If that field is absent or invalid for a direct Anthropic session, ClaudeHUD falls back to the existing local transcript-based estimate so the cost line still works on older payloads. The native field is absent before the first API response in a session, so the cost display may stay hidden until then. ClaudeHUD also keeps the cost hidden for known routed providers such as Bedrock and Vertex AI, because cloud-provider billed sessions may report `$0.00` or omit the field even though the session was not literally free. Set `display.showRoutedCost: true` (alongside `showCost`) to opt into cost for those providers anyway: the native `cost.total_cost_usd` is shown as `Cost` when positive, otherwise ClaudeHUD falls back to a token-based `Est.` from the Anthropic pricing table.

`display.showPromptCache` is fully opt-in. When enabled, ClaudeHUD looks at the timestamp of the last assistant response in the local transcript and shows a live countdown until the prompt cache expires. The default TTL is 5 minutes (`300` seconds). Set `display.promptCacheTtlSeconds` to `3600` if you want a 1-hour Max-style window. If the transcript does not have an assistant timestamp yet, the cache element stays hidden.

### Usage Limits

Usage display is **enabled by default** when Claude Code provides subscriber `rate_limits` data on stdin. It shows your rate limit consumption on line 2 alongside the context bar.

Set `display.usageValue` to `remaining` to show quota left instead of quota used. Warning colors and 7-day threshold checks still use the underlying used percentage.

ClaudeHUD prefers the official statusline stdin payload for rate-limit windows. If `display.externalUsagePath` points to a fresh local sidecar snapshot, ClaudeHUD can append its `balance_label` alongside stdin windows. If stdin `rate_limits` are missing, the same snapshot can provide fallback usage windows.

The fallback snapshot path must be absolute. The snapshot must be fresh enough (`display.externalUsageFreshnessMs`) and include valid `updated_at`, plus a `five_hour` window, `seven_day` window, or `balance_label`. `balance_label` is optional text for prepaid provider balances; it is trimmed, length-limited, and sanitized before display. Relative paths, invalid JSON, stale files, or invalid timestamps are ignored quietly.

Set `display.externalUsageWritePath` if you want ClaudeHUD to write the official stdin `rate_limits` into a local snapshot for other tools. The path must be absolute, end in `.json`, and live in an existing directory. ClaudeHUD writes the file with private permissions and ignores invalid paths quietly.

Free/weekly-only accounts render the weekly window by itself instead of showing a ghost `5h: --` placeholder.

The 7-day percentage appears when above the `display.sevenDayThreshold` (default 80%):

```
Context █████░░░░░ 45% │ Usage ██░░░░░░░░ 25% (1h 30m / 5h) | ██████████ 85% (2d / 7d)
```

To disable, set `display.showUsage` to `false`.

Reset times use relative countdowns by default. Set `display.timeFormat` to `absolute` for wall-clock
times, `both` to show both forms, `elapsed` to show how far through each usage window you are, or
`elapsedAndAbsolute` to show elapsed window progress plus the wall-clock reset time. This setting is
manual-only today; `/claude-hud:configure` preserves it without editing it.

Set `display.showResetLabel` to `false` if you want shorter usage countdowns such as `(3h 17m)` instead of `(resets in 3h 17m)`.

Set `display.usageCompact` to `true` if you want the shorter usage-only form, for example `5h: 25% (1h 30m)`. Compact usage takes precedence over `display.usageBarEnabled`.

### Security Notes

ClaudeHUD is local-only by design. It does not make network requests, scrape credentials, or call undocumented Claude APIs. It reads the statusline JSON from stdin, the current session transcript path supplied by Claude Code, selected Claude configuration files under `~/.claude`, and git metadata for the current workspace.

HUD cache files are written under `~/.claude/plugins/claude-hud` with private permissions on POSIX filesystems. The cache stores derived display metadata such as context percentages, token counters, activity names, and the resolved Claude Code version.

`--extra-cmd` is disabled unless `CLAUDE_HUD_ALLOW_EXTRA_CMD=1` (or `true`, `yes`, `on`) is present in the HUD process environment. Treat this option as arbitrary code execution: it runs the supplied shell command with your user privileges on statusline refreshes. Do not use commands copied from untrusted sources.

**Requirements:**
- Claude Code must include subscriber `rate_limits` data on stdin for the current session
- Not available for API-key-only users

**Troubleshooting:** If usage doesn't appear:
- Ensure you're logged in with a Claude subscriber account (not API key)
- Check `display.showUsage` is not set to `false` in config
- API users see no usage display (they have pay-per-token, not rate limits)
- AWS Bedrock models display `Bedrock` and hide usage limits (usage is managed in AWS)
- Bedrock and Vertex AI models hide cost estimates by default (billing differs from Anthropic direct); opt in with `display.showRoutedCost`
- Claude Code may leave `rate_limits` empty until after the first model response in a session
- Some Claude Code builds and subscription tiers may still omit `rate_limits`, even after the first response
- If you configured `display.externalUsagePath`, ClaudeHUD will try that local snapshot before hiding usage
- ClaudeHUD never falls back to credential scraping or undocumented API calls

Example fallback snapshot:

```json
{
  "updated_at": "2026-04-20T12:00:00.000Z",
  "five_hour": {
    "used_percentage": 42,
    "resets_at": "2026-04-20T15:00:00.000Z"
  },
  "seven_day": {
    "used_percentage": 84,
    "resets_at": "2026-04-27T12:00:00.000Z"
  }
}
```

### Example Configuration

```json
{
  "language": "zh",
  "lineLayout": "expanded",
  "pathLevels": 2,
  "elementOrder": ["project", "tools", "skills", "mcp", "context", "usage", "memory", "environment", "agents", "todos", "sessionTime"],
  "gitStatus": {
    "enabled": true,
    "showDirty": true,
    "showAheadBehind": true,
    "showFileStats": true
  },
  "display": {
    "showTools": true,
    "showSkills": true,
    "showMcp": true,
    "showAgents": true,
    "showTodos": true,
    "showConfigCounts": true,
    "showDuration": true,
    "showMemoryUsage": true
  },
  "colors": {
    "context": "cyan",
    "usage": "cyan",
    "warning": "yellow",
    "usageWarning": "magenta",
    "critical": "red",
    "model": "cyan",
    "project": "yellow",
    "git": "magenta",
    "gitBranch": "cyan",
    "label": "dim",
    "custom": "#FF6600"
  }
}
```

### Display Examples

**1 level (default):** `[Opus] │ my-project git:(main)`

**2 levels:** `[Opus] │ apps/my-project git:(main)`

**3 levels:** `[Opus] │ dev/apps/my-project git:(main)`

**With dirty indicator:** `[Opus] │ my-project git:(main*)`

**With ahead/behind:** `[Opus] │ my-project git:(main ↑2 ↓1)`

**With file stats:** `[Opus] │ my-project git:(main* !3 +1 ?2)`
- `!` = modified files, `+` = added/staged, `✘` = deleted, `?` = untracked
- Counts of 0 are omitted for cleaner display

### Disabling the HUD Temporarily

Set the `CLAUDE_HUD_DISABLE` environment variable to launch a session without the HUD — no need to remove the `statusLine` entry from `settings.json`:

```bash
CLAUDE_HUD_DISABLE=1 claude
```

Leaving it unset (or setting an explicit negative: `0`, `false`, `off`, `no`) keeps the HUD enabled. When disabled, the HUD exits immediately without reading the transcript or running git, so the statusline simply stays empty for that session.

### Troubleshooting

**Config not applying?**
- Check for JSON syntax errors: invalid JSON silently falls back to defaults
- Ensure valid values: `pathLevels` must be 1, 2, or 3; `lineLayout` must be `expanded` or `compact`; `maxWidth` must be a positive number
- Delete config and run `/claude-hud:configure` to regenerate

**Git status missing?**
- Verify you're in a git repository
- Check `gitStatus.enabled` is not `false` in config

**Tool/skill/MCP/agent/todo lines missing?**
- These are hidden by default — enable with `showTools`, `showSkills`, `showMcp`, `showAgents`, `showTodos` in config
- They also only appear when there's activity to show

**HUD not appearing after setup?**
- Restart Claude Code so it picks up the new statusLine config
- On macOS, fully quit Claude Code and run `claude` again in your terminal
- Make sure `CLAUDE_HUD_DISABLE` is not set in your environment (e.g. exported from a shell profile) — it silences the HUD entirely, including setup verification

---

## Requirements

- Claude Code v1.0.80+
- macOS/Linux: Node.js 18+ or Bun
- Windows: Node.js 18+

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

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=jarrodwatts/claude-hud&type=Date)](https://star-history.com/#jarrodwatts/claude-hud&Date)
