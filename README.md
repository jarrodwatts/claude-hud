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
<summary><strong>⚠️ Linux users: Click here if install fails with an EXDEV error</strong></summary>

On older Claude Code versions, `/tmp` being a separate filesystem (tmpfs) caused plugin installation to fail with:
```
EXDEV: cross-device link not permitted
```

This [Claude Code bug](https://github.com/anthropics/claude-code/issues/14799) has since been fixed — if you hit it, update Claude Code first. If you can't update, set TMPDIR before installing:
```bash
mkdir -p ~/.cache/tmp && TMPDIR=~/.cache/tmp claude
```

Then run the install command below in that session.

</details>

```
/plugin install claude-hud
```

After that, reload plugins (no restart needed):

```
/reload-plugins
```

<details>
<summary><strong>Prefer the terminal?</strong></summary>

Steps 1–2 can also be done outside a session with the Claude Code CLI:
```bash
claude plugin marketplace add jarrodwatts/claude-hud
claude plugin install claude-hud@claude-hud
```
Then run `/reload-plugins` inside your session (or start a new one).

</details>

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

Done! Claude Code reloads settings automatically — the HUD appears after your next message, no restart needed. If it doesn't show up, restart Claude Code (older versions require a restart to pick up statusLine changes).

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
- **Line 1** — Model, provider label when positively identified (for example `Bedrock`, `Vertex`, `MiniMax`), project path, git branch
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
- Re-renders after each interaction (new assistant messages, `/compact`, permission changes, vim-mode toggles), debounced at 300ms

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
`pathLevels`, `maxWidth`, threshold overrides, `display.timeFormat`, `display.hourCycle`, and `display.promptCacheTtlSeconds`. Running `/claude-hud:configure`
preserves those manual settings while still letting you change `language`, layout, and the common
guided toggles.

If you run several Claude config directories via `CLAUDE_CONFIG_DIR` and symlink `plugins/` to a
shared location, `plugins/claude-hud/config.json` is the same physical file for all of them. Put
per-directory settings in `$CLAUDE_CONFIG_DIR/claude-hud.json` instead - it uses the same shape,
only needs the keys it changes, and is layered on top of the shared config at load time:

For example, put this in `~/.config/claude/work/claude-hud.json`:

```json
{ "display": { "customLine": "Work Team" } }
```

Simplified and Traditional Chinese HUD labels are available as explicit opt-ins. English stays the default unless you choose a Chinese locale in `/claude-hud:configure` or set `language` in config. The `zh` alias maps to Simplified Chinese, and `zh-TW` maps to Traditional Chinese. Guided config writes the canonical `zh-Hans` or `zh-Hant` value.

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `language` | `en` \| `zh` \| `zh-Hans` \| `zh-Hant` \| `zh-TW` | `en` | HUD label language. Use `zh` or `zh-Hans` for Simplified Chinese and `zh-Hant` or `zh-TW` for Traditional Chinese. |
| `lineLayout` | string | `expanded` | Layout: `expanded` (multi-line) or `compact` (single line) |
| `pathLevels` | 1-3 \| `full` | 1 | Directory levels to show in project path, or `full` to show the entire absolute path |
| `maxWidth` | number \| `null` | `null` | Optional fallback width used only when terminal width detection fails completely |
| `forceMaxWidth` | boolean | false | Always use `maxWidth` when it is set, even if terminal width detection returns a smaller value |
| `elementOrder` | string[] | `["project","addedDirs","context","usage","promptCache","memory","environment","tools","skills","mcp","agents","todos","sessionTime"]` | Expanded-mode element order. Omit entries to hide them in expanded mode. Existing configs keep their explicit order until updated. |
| `projectLineOrder` | string[] | `[]` | Optional leading order of segments *within* the first line, in both layouts. Visibility stays with the `display.show*` flags, and omitted segments retain their existing renderer order. `model` covers provider + model + effort (plus the context bar in compact mode); `project` covers path + added dirs + git as one segment. Example: `["project","model"]` puts the project/git block before the model badge. |
| `display.mergeGroups` | string[][] | `[["context","usage"]]` | Expanded-mode groups that should share a line when adjacent. Set `[]` to disable merged lines. |
| `display.rightAlign` | string[] | `[]` | Starts a right-aligned suffix at the first listed element in a merged row, preserving `elementOrder` and padding the gap with spaces. Requires the anchor to be in a `display.mergeGroups` group that actually renders on one line. Ignored when the terminal width is unknown, the anchor is first, or there is no room for padding. Example: `["context"]` with a `["project","context","usage"]` group keeps project/git left and pins context + usage right. |
| `gitStatus.enabled` | boolean | true | Show git branch in HUD |
| `gitStatus.showDirty` | boolean | true | Show `*` for uncommitted changes |
| `gitStatus.showAheadBehind` | boolean | false | Show `↑N ↓N` for ahead/behind remote |
| `gitStatus.pushWarningThreshold` | number | 0 | Color the ahead count with the warning color at or above this unpushed-commit count (`0` disables it) |
| `gitStatus.pushCriticalThreshold` | number | 0 | Color the ahead count with the critical color at or above this unpushed-commit count (`0` disables it) |
| `gitStatus.showFileStats` | boolean | false | Show file change counts `!M +A ✘D ?U` |
| `gitStatus.branchOverflow` | `truncate` \| `wrap` | `truncate` | Keep current truncation behavior or let the git block wrap onto its own line boundary when possible |
| `jjStatus.enabled` | boolean | false | Opt in to jj (Jujutsu) status. When enabled and a real `.jj` directory is found, jj is used instead of git for that repo — never both |
| `jjStatus.showDirty` | boolean | true | Show `*` when the working-copy commit differs from its parent |
| `jjStatus.showConflicts` | boolean | true | Show a `!conflict` marker when the working-copy commit has an unresolved conflict |
| `display.showModel` | boolean | true | Show model name `[Opus]` |
| `display.modelSource` | `stdin` \| `auto` \| `transcript` | `stdin` | Controls which source the model name comes from. `stdin` preserves the default behavior and always uses what Claude Code reports. `auto` opts into proxy redirect detection by using transcript models only for non-Claude models. `transcript` always uses the model from the API response. Transcript model values are terminal-sanitized and capped at 80 characters |
| `display.showProvider` | boolean | false | Show the provider label *before* the model name, e.g. `[Bedrock \| Opus 4.6]`. Useful when a custom proxy serves identically-named models from different providers. When off, an auto-detected provider still trails the model as before |
| `display.providerName` | string | `""` | Explicit provider label used with `display.showProvider`, e.g. for a custom proxy that can't be auto-detected. Falls back to the auto-detected provider (Bedrock/Vertex/MiniMax/Enterprise) when empty; capped at 40 chars |
| `display.showAddedDirs` | boolean | true | Show extra workspace directories from `/add-dir` (e.g. `+sparkle +lib-foo`); empty array renders nothing. In both layouts at most 5 dirs render (overflow shown as `+N more`) and basenames are truncated to 24 chars with `…` |
| `display.addedDirsLayout` | `inline` \| `line` | `inline` | `inline` puts dirs next to the project name with a `+name` prefix per dir; `line` renders them on a separate `Added dirs: name1, name2` line (no `+` prefix, comma-separated) |
| `display.showContextBar` | boolean | true | Show visual context bar `████░░░░░░` |
| `display.contextValue` | `percent` \| `tokens` \| `remaining` \| `both` | `percent` | Context display format (`45%`, `45k/200k`, `55%` remaining, or `45% (45k/200k)`) |
| `display.autoCompactWindow` | number \| `null` | `null` | When set to a positive number such as `200000`, compute the context percentage against this auto-compact window instead of the full model context window, matching the `/context` figure. Leave unset or `null` to preserve default full-window behavior. |
| `display.showConfigCounts` | boolean | false | Show CLAUDE.md, rules, MCPs, hooks counts |
| `display.showCost` | boolean | false | Show session cost using Claude Code's native `cost.total_cost_usd` when available, with a local estimate fallback for direct Anthropic sessions |
| `display.showRoutedCost` | boolean | false | Also show cost for routed providers (Bedrock/Vertex), which `showCost` hides by default. Requires `showCost` too. Uses the native `cost.total_cost_usd` when positive (`Cost`), otherwise the token estimate (`Est.`) |
| `display.showDailyCost` | boolean | false | Show today's cumulative spend across sessions as `Today $12.34`, accumulated from the native `cost.total_cost_usd` into a small per-day ledger in the plugin data directory. Resets at local midnight. Independent of `showCost` |
| `display.showOutputStyle` | boolean | false | Show the active Claude Code `outputStyle` from settings files as `style: <name>` |
| `display.showDuration` | boolean | false | Show session duration `⏱️ 5m` |
| `display.showSpeed` | boolean | false | Show output token speed `out: 42.1 tok/s` |
| `display.showUsage` | boolean | true | Show Claude subscriber usage limits when available |
| `display.usageValue` | `percent` \| `remaining` | `percent` | Usage display format (`25%` used, or `75%` remaining) |
| `display.usageBarEnabled` | boolean | true | Display usage as visual bar instead of text |
| `display.usageCompact` | boolean | false | Display usage in a shorter text form such as `5h: 25% (1h 30m)`; takes precedence over `display.usageBarEnabled` |
| `display.showResetLabel` | boolean | true | Show the `resets in` prefix before usage countdowns |
| `display.showModelScopedUsage` | boolean | true | Show the per-model weekly windows (`model_scoped`, e.g. Fable), whether they arrive on stdin or from the external usage snapshot. Set to `false` to render the usage line as if the payload carried none of them |
| `display.timeFormat` | `relative` \| `absolute` \| `both` \| `elapsed` \| `elapsedAndAbsolute` | `relative` | How usage-window time is shown: countdown only (`resets in 2h 30m`), wall-clock reset (`resets at 14:30`), both, elapsed window percentage (`53% elapsed`), or elapsed plus wall-clock reset |
| `display.hourCycle` | `auto` \| `h11` \| `h12` \| `h23` \| `h24` | `auto` | Hour cycle for wall-clock reset times (`absolute`/`both`/`elapsedAndAbsolute` modes). `auto` defers to the system locale; `h23` forces 24-hour time (`14:30`) regardless of locale |
| `display.showClockSeconds` | boolean | false | Show seconds in wall-clock reset times, e.g. `at 14:30:07` |
| `display.sevenDayThreshold` | 0-100 | 80 | Show 7-day usage when >= threshold (0 = always) |
| `display.externalUsagePath` | string | `""` | Optional absolute path to a local usage snapshot file. Relative paths are ignored. When stdin `rate_limits` are present, `balance_label` is appended and `model_scoped` windows fill in when stdin lacks them; when stdin windows are missing, valid usage windows can be used as a fallback |
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
| `display.showAuth` | boolean | false | Show the auth method (subscription plan) of the current login as its own segment at the end of the first line, e.g. `Claude Max 20x`. Derived from the `oauthAccount` block in `{CLAUDE_CONFIG_DIR}.json`; shows `API Key` when there is no OAuth login but `ANTHROPIC_API_KEY` is set |
| `display.showAuthUser` | boolean | false | Show the logged-in account (email local part, falling back to profile display name) next to the auth method |
| `display.authUserLength` | number | `8` | Maximum characters of the account name to display before truncating with `…`. `0` shows the full name |
| `display.showAdvisor` | boolean | false | Inline the model configured via Claude Code's `/advisor` on the project line, e.g. `Advisor: Opus 4.7`. Read from the `advisorModel` field that Claude Code stamps on each assistant transcript record; sanitised and capped at 64 chars before rendering |
| `display.advisorOverride` | string | `""` | Optional manual override for the displayed advisor label. When non-empty, replaces transcript-driven detection. Also sanitised and capped at 64 chars |
| `display.showSessionStartDate` | boolean | false | Show the transcript session start timestamp |
| `display.showLastResponseAt` | boolean | false | Show how long ago the last assistant response was written |
| `display.showCompactions` | boolean | false | Show how many context compactions (manual `/compact` or auto) have occurred this session, counted from transcript `compact_boundary` entries, e.g. `Compactions: 2`. Hidden until the first compaction |
| `display.showEffortLevel` | boolean | false | Show the current reasoning effort in the model badge. Ultracode renders as `ultracode(xhigh)`, detected from the session transcript so it tracks `/effort` changes made at runtime |
| `display.effortFormat` | `full` \| `symbol` \| `text` | `full` | How the effort renders when `display.showEffortLevel` is on: symbol and level text (`◑ high`), symbol only (`◑`), or level text only (`high`). Ultracode keeps the full `◕ ultracode(xhigh)` form under `symbol` so the marker is not lost, and levels without a known symbol fall back to the level text |
| `display.showClaudeCodeVersion` | boolean | false | Show the installed Claude Code version, e.g. `CC v2.1.81` |
| `display.showMemoryUsage` | boolean | false | Show an approximate system RAM usage line in expanded layout |
| `display.showPromptCache` | boolean | false | Show the wall-clock time the session's prompt cache expires, read from the transcript |
| `display.promptCacheTtlSeconds` | number | `300` | Compatibility fallback used only when the transcript has not reported a 5-minute or 1-hour cache tier |
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

`display.showDailyCost` is fully opt-in and answers a different question than `showCost`: what has the whole day cost across sessions, not just the current conversation. On each render ClaudeHUD folds the native `cost.total_cost_usd` into a small `daily-cost.json` ledger in the plugin data directory, keyed by `session_id`, and shows the day's cumulative spend as `Today $12.34`. The first sighting of a session records a baseline so only spend from that point counts, the counter resets at local midnight, sessions spanning midnight contribute only the current day's part, and entries unseen for more than 24 hours are dropped so the file stays bounded. It only uses the native field (no estimate fallback), so sessions that never render the statusline are not counted, counting starts when the option is enabled, and totals are per machine. Routed providers (Bedrock/Vertex) are excluded unless `display.showRoutedCost` is also enabled, matching `showCost`.

Official MiniMax Anthropic-compatible endpoints receive a `MiniMax` provider label. MiniMax M2.7 can use its published token and cache prices for local estimates; M3 pricing depends on each request's context tier, which cumulative session tokens cannot safely infer, so ClaudeHUD does not guess an M3 estimate.

`display.showPromptCache` is fully opt-in. When enabled, ClaudeHUD shows **the wall-clock time the session's prompt cache expires** (e.g. `Cache ⏱ until 14:30`), or `expired` once that time has passed. It follows `display.hourCycle` and `display.showClockSeconds` like every other clock time in the HUD. If the transcript has no main-session response yet, the cache element stays hidden.

It shows an expiry time rather than a countdown because the statusline only repaints while Claude Code is active. Between turns — exactly when the cache is draining — a countdown freezes at whatever it last displayed and keeps reporting it; a clock time stays true no matter how stale the render is.

ClaudeHUD detects the cache tier from the transcript when possible. The existing `display.promptCacheTtlSeconds` setting remains a fallback for older or proxied transcripts that do not expose tier details:

- **The TTL is detected.** Every cache write records the tier it used (`usage.cache_creation.ephemeral_5m_input_tokens` vs `ephemeral_1h_input_tokens`), so a 1-hour session counts down against an hour, and a session that changes tier mid-run is followed. Detected values take precedence over the configured fallback.
- **The clock starts at the request**, not at the response it produced, because that is when the cache is read or written. Anchoring on the response would hand the session however long that response took to generate.
- **Subagent responses are ignored.** A subagent runs against its own cache and does not refresh the main session's.

### Usage Limits

Usage display is **enabled by default** when Claude Code provides subscriber `rate_limits` data on stdin. It shows your rate limit consumption on line 2 alongside the context bar.

Set `display.usageValue` to `remaining` to show quota left instead of quota used. Warning colors and 7-day threshold checks still use the underlying used percentage.

ClaudeHUD prefers the official statusline stdin payload for rate-limit windows. If `display.externalUsagePath` points to a fresh local sidecar snapshot, ClaudeHUD can append its `balance_label` alongside stdin windows. If stdin `rate_limits` are missing, the same snapshot can provide fallback usage windows.

The fallback snapshot path must be absolute. The snapshot must be fresh enough (`display.externalUsageFreshnessMs`) and include valid `updated_at`, plus a `five_hour` window, `seven_day` window, `balance_label`, or `model_scoped` array. `balance_label` is optional text for prepaid provider balances; it is trimmed, length-limited, and sanitized before display. Relative paths, invalid JSON, stale files, or invalid timestamps are ignored quietly.

The snapshot may also carry `model_scoped` windows using the same shape Claude Code defines for stdin (`display_name`, `utilization` on the 0-100 scale, ISO `resets_at`). They render exactly like stdin scoped windows (see the model-scoped usage section) and stdin always wins when it carries its own `model_scoped` data. This lets a local feeder surface per-model weekly quotas (e.g. Fable) that the statusline payload does not include yet:

```json
{
  "updated_at": "2026-07-24T14:12:37Z",
  "model_scoped": [
    { "display_name": "Fable", "utilization": 89, "resets_at": "2026-07-27T11:00:00Z" }
  ]
}
```

One zero-credential way to produce such a snapshot is Claude Code's own `get_usage` control request, which returns `rate_limits.model_scoped` without spending tokens; a scheduled job can pipe it through `jq` into the snapshot file. The HUD itself never fetches anything: it only reads the file.

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

Wall-clock reset times (`absolute`/`both`/`elapsedAndAbsolute`) default to your system locale for 12-
vs 24-hour formatting. Set `display.hourCycle` to `h23` to force 24-hour time regardless of locale, or
to `h12`/`h11` to force 12-hour time with AM/PM. Set `display.showClockSeconds` to `true` to include
seconds in the wall-clock time, e.g. `at 14:30:07`.

Set `display.showResetLabel` to `false` if you want shorter usage countdowns such as `(3h 17m)` instead of `(resets in 3h 17m)`.

Set `display.usageCompact` to `true` if you want the shorter usage-only form, for example `5h: 25% (1h 30m)`. Compact usage takes precedence over `display.usageBarEnabled`.

Set `display.showModelScopedUsage` to `false` to hide the per-model weekly windows (e.g. Fable). The usage line then renders exactly as it would for an account that has none: the 5h/7d windows stay, snapshot windows are hidden along with the stdin ones, and a hidden window no longer counts toward a configured usage threshold, so it can no longer keep the line on screen by itself.

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
  "projectLineOrder": ["project", "model"],
  "gitStatus": {
    "enabled": true,
    "showDirty": true,
    "showAheadBehind": true,
    "showFileStats": true
  },
  "jjStatus": {
    "enabled": true,
    "showDirty": true,
    "showConflicts": true
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

### Jujutsu (jj) support

Set `jjStatus.enabled` to `true` to opt in. When a real `.jj` directory is found
in (or above) the working directory, the HUD shows jj-native status instead of
git — the two are mutually exclusive per invocation, even in a colocated jj+git
repo. If jj cannot be queried safely, a colocated repository falls back to its
existing git status.

**With a bookmark:** `[Opus] │ my-project jj:(mybookmark)`

**Anonymous change (no bookmark at `@`):** `[Opus] │ my-project jj:(wrulwzyw)`

**Dirty working copy:** `[Opus] │ my-project jj:(mybookmark*)`

**Unresolved conflict:** `[Opus] │ my-project jj:(mybookmark !conflict)`

Ahead/behind counts and per-file change stats are git-only in this version —
jj's equivalent requires more expensive revset queries against
`remote_bookmarks()`, so they're left out to keep the jj status fetch to a
single subprocess call.

The HUD runs jj in prompt-safe, read-only mode: it disables the pager, ignores
the live working copy, and reads the current operation without reconciling it.
That avoids snapshotting files or mutating repository state during statusline
refreshes. As a result, the dirty marker reflects jj's most recent working-copy
snapshot and can remain stale until another jj command records new changes.

### Auto-Refresh

Claude Code only re-runs the statusline after an interaction (a new assistant message, `/compact` finishing, a permission-mode change, or a vim-mode toggle), so time-based HUD info — session duration, usage reset countdowns, the prompt-cache countdown — goes stale between messages. To keep it ticking, add `refreshInterval` (seconds, minimum 1) to the `statusLine` entry in `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "...",
    "refreshInterval": 5
  }
}
```

`/claude-hud:setup` offers this during installation. Each refresh re-runs the HUD command, so 5 seconds is a good default; use 1 second only if you want visibly smooth countdowns.

### Disabling the HUD Temporarily

Set the `CLAUDE_HUD_DISABLE` environment variable to launch a session without the HUD — no need to remove the `statusLine` entry from `settings.json`:

```bash
CLAUDE_HUD_DISABLE=1 claude
```

Leaving it unset (or setting an explicit negative: `0`, `false`, `off`, `no`) keeps the HUD enabled. When disabled, the HUD exits immediately without reading the transcript or running git, so the statusline simply stays empty for that session.

### Troubleshooting

**Config not applying?**
- Check for JSON syntax errors: invalid JSON silently falls back to defaults
- Ensure valid values: `pathLevels` must be 1, 2, 3, or `full`; `lineLayout` must be `expanded` or `compact`; `maxWidth` must be a positive number
- Delete config and run `/claude-hud:configure` to regenerate

**Git status missing?**
- Verify you're in a git repository
- Check `gitStatus.enabled` is not `false` in config

**jj status missing, or seeing `git:(...)` in a jj repo?**
- Verify a `.jj` directory exists at or above the working directory
- Set `jjStatus.enabled` to `true` in config (jj support is opt-in)
- Verify the `jj` binary is installed and on `PATH`

**Tool/skill/MCP/agent/todo lines missing?**
- These are hidden by default — enable with `showTools`, `showSkills`, `showMcp`, `showAgents`, `showTodos` in config
- They also only appear when there's activity to show

**HUD not appearing after setup?**
- Send any message — settings reload automatically, but the statusline only renders after your next interaction
- If it still doesn't appear, restart Claude Code (fully quit and run `claude` again) — older Claude Code versions require a restart to pick up statusLine changes
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
