# Claude HUD

A Claude Code plugin that shows what's happening: context usage, rate limits, active tools, running agents, and todo progress, always visible below your input.

[![License](https://img.shields.io/github/license/jarrodwatts/claude-hud?v=2)](LICENSE)
[![Stars](https://img.shields.io/github/stars/jarrodwatts/claude-hud)](https://github.com/jarrodwatts/claude-hud/stargazers)

![Claude HUD in action](claude-hud-preview-5-2.png)

> 🌐 English | [中文文档](README.zh.md)

## Install

Inside Claude Code, run:

```
/plugin marketplace add jarrodwatts/claude-hud
/plugin install claude-hud
/reload-plugins
/claude-hud:setup
```

`/claude-hud:setup` points your status line at the HUD. Claude Code reloads settings on its own, so the HUD appears after your next message.

<details>
<summary><strong>Prefer the terminal?</strong></summary>

```bash
claude plugin marketplace add jarrodwatts/claude-hud
claude plugin install claude-hud@claude-hud
```

Then run `/reload-plugins` and `/claude-hud:setup` inside a session.

</details>

<details>
<summary><strong>Windows: setup says no JavaScript runtime was found</strong></summary>

Install Node.js LTS (`winget install OpenJS.NodeJS.LTS`), restart your shell, and run `/claude-hud:setup` again.

</details>

## What You See

The default is two lines:

```
[Opus] │ my-project git:(main*)
Context █████░░░░░ 45% │ Usage ██░░░░░░░░ 25% (resets in 1h 30m)
```

- **Line 1**: model, a provider label when one is detected (`Bedrock`, `Vertex`, `MiniMax`), project path, and git branch.
- **Line 2**: context used (green, then yellow, then red as it fills) and your subscriber rate limits.

Optional lines, which you turn on with `/claude-hud:configure`:

```
◐ Edit: auth.ts | ✓ Read ×3 | ✓ Grep ×2        ← tools
◐ explore [haiku]: Finding auth code (2m 15s)    ← agents
▸ Fix authentication bug (2/5)                   ← todos
```

## How It Works

Claude HUD is a [status line](https://code.claude.com/docs/en/statusline) command. Claude Code runs it with session data on stdin (model, context window, cost, rate limits, prompt cache) and shows what it prints. Some optional elements, such as the tools, agents, and todos lines, also read the session transcript. It needs no separate window or tmux and works in any terminal.

## Configuration

```
/claude-hud:configure
```

The guided flow covers layout, activity lines, session info, usage, git, language, and a custom line. It previews the changes before saving and keeps every setting it doesn't ask about.

Everything else lives in `~/.claude/plugins/claude-hud/config.json` (or under `$CLAUDE_CONFIG_DIR`). Invalid values fall back to their defaults.

If several `CLAUDE_CONFIG_DIR`s share one `plugins/` directory, put per-directory settings in `$CLAUDE_CONFIG_DIR/claude-hud.json`. It uses the same shape, only needs the keys it changes, and is layered on top of the shared config:

```json
{ "display": { "customLine": "Work Team" } }
```

Labels are available in English (the default), Simplified Chinese (`zh-Hans`, alias `zh`), and Traditional Chinese (`zh-Hant`, alias `zh-TW`).

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `language` | `en` \| `zh` \| `zh-Hans` \| `zh-Hant` \| `zh-TW` | `en` | HUD label language. Use `zh` or `zh-Hans` for Simplified Chinese and `zh-Hant` or `zh-TW` for Traditional Chinese. |
| `lineLayout` | string | `expanded` | Layout: `expanded` (multi-line) or `compact` (single line) |
| `showSeparators` | boolean | false | In `compact` layout, draw a rule between the session line and the activity lines |
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
| `gitStatus.showWorktree` | boolean | false | In a linked git worktree, show its name after the branch, e.g. `git:(feat/x) ⎇ feat-x` |
| `gitStatus.branchOverflow` | `truncate` \| `wrap` | `truncate` | Keep current truncation behavior or let the git block wrap onto its own line boundary when possible |
| `jjStatus.enabled` | boolean | false | Opt in to jj (Jujutsu) status. When enabled and a real `.jj` directory is found, jj is used instead of git for that repo — never both |
| `jjStatus.showDirty` | boolean | true | Show `*` when the working-copy commit differs from its parent |
| `jjStatus.showConflicts` | boolean | true | Show a `!conflict` marker when the working-copy commit has an unresolved conflict |
| `display.showModel` | boolean | true | Show model name `[Opus]` |
| `display.showProject` | boolean | true | Show the project path |
| `display.modelSource` | `stdin` \| `auto` \| `transcript` | `stdin` | Controls which source the model name comes from. `stdin` preserves the default behavior and always uses what Claude Code reports. `auto` opts into proxy redirect detection by using transcript models only for non-Claude models. `transcript` always uses the model from the API response. Transcript model values are terminal-sanitized and capped at 80 characters |
| `display.modelFormat` | `full` \| `compact` \| `short` | `full` | `compact` drops a context-window suffix such as `(1M context)`; `short` also drops a leading `Claude ` |
| `display.modelOverride` | string | `""` | Show this text instead of the model name (80 characters max) |
| `display.showProvider` | boolean | false | Show the provider label *before* the model name, e.g. `[Bedrock \| Opus 4.6]`. Useful when a custom proxy serves identically-named models from different providers. When off, an auto-detected provider still trails the model as before |
| `display.providerName` | string | `""` | Explicit provider label used with `display.showProvider`, e.g. for a custom proxy that can't be auto-detected. Falls back to the auto-detected provider (Bedrock/Vertex/MiniMax/Enterprise) when empty; capped at 40 chars |
| `display.showAddedDirs` | boolean | true | Show extra workspace directories from `/add-dir` (e.g. `+sparkle +lib-foo`); empty array renders nothing. In both layouts at most 5 dirs render (overflow shown as `+N more`) and basenames are truncated to 24 chars with `…` |
| `display.addedDirsLayout` | `inline` \| `line` | `inline` | `inline` puts dirs next to the project name with a `+name` prefix per dir; `line` renders them on a separate `Added dirs: name1, name2` line (no `+` prefix, comma-separated) |
| `display.showContextBar` | boolean | true | Show visual context bar `████░░░░░░` |
| `display.contextValue` | `percent` \| `tokens` \| `remaining` \| `both` | `percent` | Context display format (`45%`, `45k/200k`, `55%` remaining, or `45% (45k/200k)`) |
| `display.autoCompactWindow` | number \| `null` | `null` | When set to a positive number such as `200000`, compute the context percentage against this auto-compact window instead of the full model context window, matching the `/context` figure. Leave unset or `null` to preserve default full-window behavior. |
| `display.showConfigCounts` | boolean | false | Show CLAUDE.md, rules, MCPs, hooks counts |
| `display.environmentThreshold` | number | 0 | Hide the config counts until their total reaches this number (0 = always show) |
| `display.showCost` | boolean | false | Show the session cost Claude Code reports (`cost.total_cost_usd`) |
| `display.showRoutedCost` | boolean | false | Also show cost for Bedrock and Vertex sessions, which `showCost` hides because they bill through the cloud provider. Requires `showCost` |
| `display.showDailyCost` | boolean | false | Show today's cumulative spend across sessions as `Today $12.34`, accumulated from the native `cost.total_cost_usd` into a small per-day ledger in the plugin data directory. Resets at local midnight. Independent of `showCost` |
| `display.showWeeklyCost` | boolean | false | Show spend since the weekly quota window opened as `Week $123.45`, from the same ledger as `showDailyCost`. Subscribers only: needs the 7-day usage window |
| `display.showOutputStyle` | boolean | false | Show the current output style as `style: <name>` |
| `display.showDuration` | boolean | false | Show how long the session has been running, e.g. `⏱️ 5m` |
| `display.showSpeed` | boolean | false | Show the latest response's output speed `out: 42.1 tok/s` |
| `display.showUsage` | boolean | true | Show Claude subscriber usage limits when available |
| `display.usageValue` | `percent` \| `remaining` | `percent` | Usage display format (`25%` used, or `75%` remaining) |
| `display.usageBarEnabled` | boolean | true | Display usage as visual bar instead of text |
| `display.usageCompact` | boolean | false | Display usage in a shorter text form such as `5h: 25% (1h 30m)`; takes precedence over `display.usageBarEnabled` |
| `display.showResetLabel` | boolean | true | Show the `resets in` prefix before usage countdowns |
| `display.showModelScopedUsage` | boolean | true | Show the per-model weekly windows (`model_scoped`, e.g. Fable), whether they arrive on stdin or from the external usage snapshot. Set to `false` to render the usage line as if the payload carried none of them |
| `display.usagePace` | boolean | false | Colour usage windows amber or red, marked `▲`, when they are on track to run out before they reset |
| `display.timeFormat` | `relative` \| `absolute` \| `both` \| `elapsed` \| `elapsedAndAbsolute` | `relative` | How usage-window time is shown: countdown only (`resets in 2h 30m`), wall-clock reset (`resets at 14:30`), both, elapsed window percentage (`53% elapsed`), or elapsed plus wall-clock reset |
| `display.hourCycle` | `auto` \| `h11` \| `h12` \| `h23` \| `h24` | `auto` | Hour cycle for wall-clock reset times (`absolute`/`both`/`elapsedAndAbsolute` modes). `auto` defers to the system locale; `h23` forces 24-hour time (`14:30`) regardless of locale |
| `display.showClockSeconds` | boolean | false | Show seconds in wall-clock reset times, e.g. `at 14:30:07` |
| `display.usageThreshold` | 0-100 | 0 | Hide the usage display until either window reaches this percentage (0 = always show) |
| `display.sevenDayThreshold` | 0-100 | 80 | Show 7-day usage when >= threshold (0 = always) |
| `display.externalUsagePath` | string | `""` | Optional absolute path to a local usage snapshot file. A leading `~` and `${VAR}` are expanded. Relative paths are ignored. When stdin `rate_limits` are present, `balance_label` is appended and `model_scoped` windows fill in when stdin lacks them; when stdin windows are missing, valid usage windows can be used as a fallback |
| `display.externalUsageWritePath` | string | `""` | Optional absolute `.json` path in an existing directory. A leading `~` and `${VAR}` are expanded. When stdin `rate_limits` exists, ClaudeHUD writes a private snapshot for other local tools. Relative paths, non-json files, and missing parent directories are ignored |
| `display.externalUsageFreshnessMs` | number | `300000` | Maximum allowed age for the external usage snapshot before it is ignored |
| `display.showTokenBreakdown` | boolean | true | Show token details at high context (85%+) |
| `display.contextWarningThreshold` | 0-100 | 70 | Context percentage at which the context bar turns the warning colour |
| `display.contextCriticalThreshold` | 0-100 | 85 | Context percentage at which the context bar turns the critical colour and shows the token breakdown |
| `display.showTools` | boolean | false | Show tools activity line |
| `display.showSkills` | boolean | false | Show active Skills detected from `Skill` tool invocations |
| `display.showMcp` | boolean | false | Show active MCP servers detected from `mcp__server__tool` invocations |
| `display.toolNameMaxLength` | number | `0` | Maximum displayed tool-name length. `0` keeps full names; MCP names may shorten to their final segment when truncating |
| `display.toolsMaxVisible` | number | `4` | Maximum completed tools shown on the tools line. `0` means unlimited |
| `display.skillsMaxVisible` | number | `4` | Maximum skill names shown on the skills line before `+N more`. `0` means unlimited |
| `display.showAgents` | boolean | false | Show agents activity line |
| `display.showTodos` | boolean | false | Show todos progress line |
| `display.showSessionName` | boolean | false | Show the session name: the `/rename` name, or the title Claude Code generated |
| `display.showSessionTokens` | boolean | false | Show the session's cumulative token totals, e.g. `Tokens 262k (in: 6k, out: 2k, cache: 254k)` |
| `display.showAuth` | boolean | false | Show the auth method (subscription plan) of the current login as its own segment at the end of the first line, e.g. `Claude Max 20x`. Derived from the `oauthAccount` block in `~/.claude.json` (or `$CLAUDE_CONFIG_DIR/.claude.json` when the config directory is overridden); shows `API Key` when there is no OAuth login but `ANTHROPIC_API_KEY` is set |
| `display.showAuthUser` | boolean | false | Show the logged-in account (email local part, falling back to profile display name) next to the auth method |
| `display.authUserLength` | number | `8` | Maximum characters of the account name to display before truncating with `…`. `0` shows the full name |
| `display.showAdvisor` | boolean | false | Inline the model configured via Claude Code's `/advisor` on the project line, e.g. `Advisor: Opus 4.7`. Read from the `advisorModel` field that Claude Code stamps on each assistant transcript record; sanitised and capped at 64 chars before rendering |
| `display.advisorOverride` | string | `""` | Optional manual override for the displayed advisor label. When non-empty, replaces transcript-driven detection. Also sanitised and capped at 64 chars |
| `display.showSessionStartDate` | boolean | false | Show the transcript session start timestamp |
| `display.showLastResponseAt` | boolean | false | Show how long ago the last assistant response was written |
| `display.showCompactions` | boolean | false | Show how many context compactions (manual `/compact` or auto) have occurred this session, counted from transcript `compact_boundary` entries, e.g. `Compactions: 2`. Hidden until the first compaction |
| `display.showEffortLevel` | boolean | false | Show the current reasoning effort in the model badge. Ultracode renders as `ultracode(xhigh)`, detected from the session transcript so it tracks `/effort` changes made at runtime |
| `display.effortFormat` | `full` \| `symbol` \| `text` | `full` | How the effort renders when `display.showEffortLevel` is on: symbol and level text (`◑ high`), symbol only (`◑`), or level text only (`high`). Ultracode keeps the full `◕ ultracode(xhigh)` form under `symbol` so the marker is not lost, and levels without a known symbol fall back to the level text |
| `display.showClaudeCodeVersion` | boolean | false | Show the running Claude Code version, e.g. `CC v2.1.81` |
| `display.showMemoryUsage` | boolean | false | Show an approximate system RAM usage line in expanded layout |
| `display.showPromptCache` | boolean | false | Show when the main conversation's prompt cache expires |
| `display.showCacheHitRate` | boolean | false | Show the session's prompt-cache hit rate as `Cache hit X%` |
| `display.customLine` | string | `""` | Custom text shown on the first line (80 characters max) |
| `display.customLinePosition` | `first` \| `last` | `last` | Put the custom text at the start or the end of the first line |
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

Colors accept a name (`dim`, `red`, `green`, `yellow`, `magenta`, `cyan`, `brightBlue`, `brightMagenta`), a 256-color number (`0-255`), or hex (`#rrggbb`). `colors.barFilled` and `colors.barEmpty` take a single visible character; wide characters such as emoji may affect bar alignment in some terminals.

### Usage Limits

Usage shows whenever Claude Code sends subscriber `rate_limits`, which is after the first response of a session. API-key, Bedrock, and Vertex sessions have no subscriber limits, so it stays hidden. The 7-day window appears once it passes `display.sevenDayThreshold`:

```
Context █████░░░░░ 45% │ Usage ██░░░░░░░░ 25% (resets in 1h 30m) | Weekly █████████░ 85% (resets in 1d)
```

With `display.usagePace`, a window you're using faster than it refills turns amber (on track to end at 90% or more) or red (on track to run out first) and gets a `▲`. Windows under 10% used stay neutral.

**External snapshot.** `display.externalUsagePath` reads a local JSON file. Its windows fill in when stdin has none, and its `balance_label` or `model_scoped` windows (for example a per-model weekly quota) add to stdin's. The file must be absolute and fresher than `display.externalUsageFreshnessMs`:

```json
{
  "updated_at": "2026-04-20T12:00:00.000Z",
  "five_hour": { "used_percentage": 42, "resets_at": "2026-04-20T15:00:00.000Z" },
  "seven_day": { "used_percentage": 84, "resets_at": "2026-04-27T12:00:00.000Z" },
  "balance_label": "$12.50",
  "model_scoped": [{ "display_name": "Fable", "utilization": 89, "resets_at": "2026-04-27T11:00:00Z" }]
}
```

`display.externalUsageWritePath` does the reverse: it writes stdin's rate limits to a private `.json` file in an existing directory for other tools to read.

### Cost

`display.showCost` shows Claude Code's own session cost, computed at list price or from your `modelPricing` table. Bedrock and Vertex bill through the cloud provider, so their cost is hidden unless `display.showRoutedCost` is also set.

`display.showDailyCost` adds today's spend across sessions (`Today $12.34`). It is kept in a small ledger in the plugin data directory, resets at local midnight, and counts a session from the first render that sees it. `display.showWeeklyCost` uses the same ledger from the start of the 7-day quota window, so it needs a subscriber session.

### Prompt Cache

`display.showPromptCache` shows when the main conversation's prompt cache goes cold, such as `Cache ⏱ until 14:30`, or `expired`. It shows a clock time rather than a countdown because the status line doesn't repaint between turns, which is exactly when the cache drains; a clock time stays correct however old the render is. `display.showCacheHitRate` shows the share of input tokens read from the cache.

### Jujutsu (jj)

Set `jjStatus.enabled` to `true` to show jj status, such as `jj:(mybookmark*)` or `jj:(wrulwzyw !conflict)`, instead of git in a directory with a `.jj` repository. The HUD runs jj read-only without snapshotting the working copy, so the dirty marker reflects jj's last snapshot. Ahead/behind and file stats are git-only.

### Example

```json
{
  "lineLayout": "expanded",
  "pathLevels": 2,
  "gitStatus": { "showAheadBehind": true, "showFileStats": true },
  "display": {
    "showTools": true,
    "showAgents": true,
    "showTodos": true,
    "showDuration": true,
    "showCost": true
  },
  "colors": { "context": "cyan", "custom": "#FF6600" }
}
```

### Auto-Refresh

Claude Code re-runs the status line after each message, `/compact`, a permission or vim mode change, a rate-limit reset, and a prompt-cache expiry. To keep countdowns and durations ticking while a session is idle, add `refreshInterval` (seconds) to the `statusLine` entry in `~/.claude/settings.json`. `/claude-hud:setup` offers this.

### Turning It Off for a Session

```bash
CLAUDE_HUD_DISABLE=1 claude
```

Any value other than `0`, `false`, `off`, or `no` blanks the HUD for that session without touching `settings.json`.

## Security

Claude HUD is local-only. It makes no network requests, never reads credentials, and calls no undocumented APIs. It reads Claude Code's stdin, the session transcript, Claude configuration files, and git or jj metadata for the current directory. Its only writes are small state files (output speed and the cost ledger) under `~/.claude/plugins/claude-hud`, with private permissions.

`--extra-cmd` runs a shell command on every refresh and puts its output on the first line. It is ignored unless `CLAUDE_HUD_ALLOW_EXTRA_CMD=1` is set in the HUD's environment. Treat it as arbitrary code execution and never use a command from an untrusted source.

## Troubleshooting

**The HUD doesn't appear.** Send a message, because the status line renders after an interaction. Check that `CLAUDE_HUD_DISABLE` isn't set in your shell. Run `/claude-hud:setup` again if your Node or Bun path changed, for example after an nvm or mise upgrade.

**Config isn't applying.** Check the JSON for syntax errors: an invalid file falls back to the defaults. Check that values are in range; the options table lists them.

**Usage is missing.** Usage needs a Claude subscriber login and appears after the first response. Check `display.showUsage`.

**Git or jj status is missing.** Check that you're inside a repository and that `gitStatus.enabled` (or `jjStatus.enabled` with `jj` on `PATH`) is on.

**An activity line is missing.** Tools, agents, todos, skills, and MCP lines are off by default and only show when there's activity.

## Requirements

- Claude Code v2.1.260 or later
- macOS or Linux: Node.js 18+ or Bun
- Windows: Node.js 18+

## Development

```bash
git clone https://github.com/jarrodwatts/claude-hud
cd claude-hud
npm ci && npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=jarrodwatts/claude-hud&type=Date)](https://star-history.com/#jarrodwatts/claude-hud&Date)
