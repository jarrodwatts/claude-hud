import { configKeys, type ConfigKey } from "./config.ts";

// What `hud schema` tells the user's Claude. Keys, defaults and accepted values come from
// DEFAULT_CONFIG and the validation rules in config.ts; this file adds only the words. A test
// checks that every config key has a description here and nothing else does.

export const DESCRIPTIONS: Record<string, string> = {
  language: "HUD label language. Use `zh` or `zh-Hans` for Simplified Chinese and `zh-Hant` or `zh-TW` for Traditional Chinese.",
  lineLayout: "Layout: `expanded` (multi-line) or `compact` (single line)",
  showSeparators: "In `compact` layout, draw a rule between the session line and the activity lines",
  pathLevels: "Directory levels to show in project path, or `full` to show the entire absolute path",
  maxWidth: "Optional fallback width used only when terminal width detection fails completely",
  forceMaxWidth: "Always use `maxWidth` when it is set, even if terminal width detection returns a smaller value",
  elementOrder: "Expanded-mode element order. Omit entries to hide them in expanded mode. Existing configs keep their explicit order until updated. `sessionTokens` isn't in the default order: add it to place the `display.showSessionTokens` summary like any other element, for example in a `display.mergeGroups` group with `project`. Left out, it stays on its own last line. `cost` works the same way: left out, the cost segment stays on the first line (where `projectLineOrder` can move it); added, it becomes its own element, for example `\"context\",\"usage\",\"cost\"` in `elementOrder` with `[\"context\",\"usage\",\"cost\"]` in `display.mergeGroups` puts it beside context and usage.",
  projectLineOrder: "Optional leading order of segments *within* the first line, in both layouts. Visibility stays with the `display.show*` flags, and omitted segments retain their existing renderer order. `model` covers provider + model + effort (plus the context bar in compact mode); `project` covers path + added dirs + git as one segment. Example: `[\"project\",\"model\"]` puts the project/git block before the model badge.",
  "display.mergeGroups": "Expanded-mode groups that should share a line when adjacent. Set `[]` to disable merged lines.",
  "display.rightAlign": "Starts a right-aligned suffix at the first listed element in a merged row, preserving `elementOrder` and padding the gap with spaces. Requires the anchor to be in a `display.mergeGroups` group that actually renders on one line. Ignored when the terminal width is unknown, the anchor is first, or there is no room for padding. Example: `[\"context\"]` with a `[\"project\",\"context\",\"usage\"]` group keeps project/git left and pins context + usage right.",
  "gitStatus.enabled": "Show git branch in HUD",
  "gitStatus.showDirty": "Show `*` for uncommitted changes",
  "gitStatus.showAheadBehind": "Show `↑N ↓N` for ahead/behind remote",
  "gitStatus.pushWarningThreshold": "Color the ahead count with the warning color at or above this unpushed-commit count (`0` disables it)",
  "gitStatus.pushCriticalThreshold": "Color the ahead count with the critical color at or above this unpushed-commit count (`0` disables it)",
  "gitStatus.showFileStats": "Show file change counts `!M +A ✘D ?U`",
  "gitStatus.showWorktree": "In a linked git worktree, show its name after the branch, e.g. `git:(feat/x) ⎇ feat-x`",
  "gitStatus.branchOverflow": "Keep current truncation behavior or let the git block wrap onto its own line boundary when possible",
  "jjStatus.enabled": "Opt in to jj (Jujutsu) status. When enabled and a real `.jj` directory is found, jj is used instead of git for that repo — never both",
  "jjStatus.showDirty": "Show `*` when the working-copy commit differs from its parent",
  "jjStatus.showConflicts": "Show a `!conflict` marker when the working-copy commit has an unresolved conflict",
  "display.showModel": "Show model name `[Opus]`",
  "display.showProject": "Show the project path",
  "display.showLaunchDir": "Prefix the project path with the name of the directory Claude Code was launched in, when the shown path doesn't already include it (e.g. `my-repo › src`). No effect with `pathLevels: \"full\"`",
  "display.modelSource": "Controls which source the model name comes from. `stdin` preserves the default behavior and always uses what Claude Code reports. `auto` opts into proxy redirect detection by using transcript models only for non-Claude models. `transcript` always uses the model from the API response. Transcript model values are terminal-sanitized and capped at 80 characters",
  "display.modelFormat": "`compact` drops a context-window suffix such as `(1M context)`; `short` also drops a leading `Claude `",
  "display.modelOverride": "Show this text instead of the model name (80 characters max)",
  "display.showProvider": "Opus 4.6]`. Useful when a custom proxy serves identically-named models from different providers. When off, an auto-detected provider still trails the model as before",
  "display.providerName": "Explicit provider label used with `display.showProvider`, e.g. for a custom proxy that can't be auto-detected. Falls back to the auto-detected provider (Bedrock/Vertex/MiniMax/Enterprise) when empty; capped at 40 chars",
  "display.showAddedDirs": "Show extra workspace directories from `/add-dir` (e.g. `+sparkle +lib-foo`); empty array renders nothing. In both layouts at most 5 dirs render (overflow shown as `+N more`) and basenames are truncated to 24 chars with `…`",
  "display.addedDirsLayout": "`inline` puts dirs next to the project name with a `+name` prefix per dir; `line` renders them on a separate `Added dirs: name1, name2` line (no `+` prefix, comma-separated)",
  "display.showContextBar": "Show visual context bar `████░░░░░░`",
  "display.contextValue": "Context display format (`45%`, `45k/200k`, `55%` remaining, or `45% (45k/200k)`)",
  "display.autoCompactWindow": "When set to a positive number such as `200000`, compute the context percentage against this auto-compact window instead of the full model context window, matching the `/context` figure. Leave unset or `null` to preserve default full-window behavior.",
  "display.showConfigCounts": "Show CLAUDE.md, rules, MCPs, hooks counts",
  "display.environmentThreshold": "Hide the config counts until their total reaches this number (0 = always show)",
  "display.showCost": "Show the session cost Claude Code reports (`cost.total_cost_usd`)",
  "display.showRoutedCost": "Also show cost for Bedrock and Vertex sessions, which `showCost` hides because they bill through the cloud provider. Requires `showCost`",
  "display.showDailyCost": "Show today's cumulative spend across sessions as `Today $12.34`, accumulated from the native `cost.total_cost_usd` into a small per-day ledger in the plugin data directory. Resets at local midnight. Independent of `showCost`",
  "display.showWeeklyCost": "Show spend since the weekly quota window opened as `Week $123.45`, from the same ledger as `showDailyCost`. Subscribers only: needs the 7-day usage window",
  "display.showOutputStyle": "Show the current output style as `style: <name>`",
  "display.showDuration": "Show how long the session has been running, e.g. `⏱️ 5m`",
  "display.showSpeed": "Show the latest response's output speed `out: 42.1 tok/s`",
  "display.showUsage": "Show Claude subscriber usage limits when available",
  "display.usageValue": "Usage display format (`25%` used, or `75%` remaining)",
  "display.usageBarEnabled": "Display usage as visual bar instead of text",
  "display.usageCompact": "Display usage in a shorter text form such as `5h: 25% (1h 30m)`; takes precedence over `display.usageBarEnabled`",
  "display.showResetLabel": "Show the `resets in` prefix before usage countdowns",
  "display.showModelScopedUsage": "Show the per-model weekly windows (`model_scoped`, e.g. Fable), whether they arrive on stdin or from the external usage snapshot. Set to `false` to render the usage line as if the payload carried none of them",
  "display.usagePace": "Colour usage windows amber or red, marked `▲`, when they are on track to run out before they reset",
  "display.timeFormat": "How usage-window time is shown: countdown only (`resets in 2h 30m`), wall-clock reset (`resets at 14:30`), both, elapsed window percentage (`53% elapsed`), or elapsed plus wall-clock reset",
  "display.hourCycle": "Hour cycle for wall-clock reset times (`absolute`/`both`/`elapsedAndAbsolute` modes). `auto` defers to the system locale; `h23` forces 24-hour time (`14:30`) regardless of locale",
  "display.showClockSeconds": "Show seconds in wall-clock reset times, e.g. `at 14:30:07`",
  "display.usageThreshold": "Hide the usage display until either window reaches this percentage (0 = always show)",
  "display.sevenDayThreshold": "Show 7-day usage when >= threshold (0 = always)",
  "display.externalUsagePath": "Optional absolute path to a local usage snapshot file. A leading `~` and `${VAR}` are expanded. Relative paths are ignored. When stdin `rate_limits` are present, `balance_label` is appended and `model_scoped` windows fill in when stdin lacks them; when stdin windows are missing, valid usage windows can be used as a fallback",
  "display.externalUsageWritePath": "Optional absolute `.json` path in an existing directory. A leading `~` and `${VAR}` are expanded. When stdin `rate_limits` exists, ClaudeHUD writes a private snapshot for other local tools. Relative paths, non-json files, and missing parent directories are ignored",
  "display.externalUsageFreshnessMs": "Maximum allowed age for the external usage snapshot before it is ignored",
  "display.showTokenBreakdown": "Show token details at high context (85%+)",
  "display.contextWarningThreshold": "Context percentage at which the context bar turns the warning colour",
  "display.contextCriticalThreshold": "Context percentage at which the context bar turns the critical colour and shows the token breakdown",
  "display.showTools": "Show tools activity line",
  "display.showSkills": "Show active Skills detected from `Skill` tool invocations",
  "display.showMcp": "Show active MCP servers detected from `mcp__server__tool` invocations",
  "display.toolNameMaxLength": "Maximum displayed tool-name length. `0` keeps full names; MCP names may shorten to their final segment when truncating",
  "display.toolsMaxVisible": "Maximum completed tools shown on the tools line. `0` means unlimited",
  "display.skillsMaxVisible": "Maximum skill names shown on the skills line before `+N more`. `0` means unlimited",
  "display.showAgents": "Show agents activity line",
  "display.showTodos": "Show todos progress line",
  "display.showSessionName": "Show the session name: the `/rename` name, or the title Claude Code generated",
  "display.showSessionTokens": "Show the session's cumulative token totals, e.g. `Tokens 262k (in: 6k, out: 2k, cache: 254k)`",
  "display.showAuth": "Show the auth method (subscription plan) of the current login as its own segment at the end of the first line, e.g. `Claude Max 20x`. Derived from the `oauthAccount` block in `~/.claude.json` (or `$CLAUDE_CONFIG_DIR/.claude.json` when the config directory is overridden); shows `API Key` when there is no OAuth login but `ANTHROPIC_API_KEY` is set",
  "display.showAuthUser": "Show the logged-in account (email local part, falling back to profile display name) next to the auth method",
  "display.authUserFullEmail": "With `showAuthUser`, show the whole email address (e.g. `you@example.com`) instead of the part before `@`. `authUserLength` still applies; set it to `0` to see the address in full",
  "display.authUserLength": "Maximum characters of the account name to display before truncating with `…`. `0` shows the full name",
  "display.showAdvisor": "Inline the model configured via Claude Code's `/advisor` on the project line, e.g. `Advisor: Opus 4.7`. Read from the `advisorModel` field that Claude Code stamps on each assistant transcript record; sanitised and capped at 64 chars before rendering",
  "display.advisorOverride": "Optional manual override for the displayed advisor label. When non-empty, replaces transcript-driven detection. Also sanitised and capped at 64 chars",
  "display.showSessionStartDate": "Show the transcript session start timestamp",
  "display.showLastResponseAt": "Show how long ago the last assistant response was written",
  "display.showCompactions": "Show how many context compactions (manual `/compact` or auto) have occurred this session, counted from transcript `compact_boundary` entries, e.g. `Compactions: 2`. Hidden until the first compaction",
  "display.showEffortLevel": "Show the current reasoning effort in the model badge. Ultracode renders as `ultracode(xhigh)`, detected from the session transcript so it tracks `/effort` changes made at runtime",
  "display.effortFormat": "How the effort renders when `display.showEffortLevel` is on: symbol and level text (`◑ high`), symbol only (`◑`), or level text only (`high`). Ultracode keeps the full `◕ ultracode(xhigh)` form under `symbol` so the marker is not lost, and levels without a known symbol fall back to the level text",
  "display.showAgentEffort": "With `display.showAgents`, show each subagent's reasoning effort next to its model, e.g. `◐ code-reviewer [haiku-4.5 ◔ medium]`, in `display.effortFormat`. Read from the subagent's own transcript, so it appears once Claude Code has recorded the agent's id (at launch for background agents, at the end otherwise) and its first reply",
  "display.showClaudeCodeVersion": "Show the running Claude Code version, e.g. `CC v2.1.81`",
  "display.showMemoryUsage": "Show an approximate system RAM usage line in expanded layout",
  "display.showPromptCache": "Show when the main conversation's prompt cache expires",
  "display.showCacheHitRate": "Show the session's prompt-cache hit rate as `Cache hit X%`",
  "display.customLine": "Custom text shown on the first line (80 characters max)",
  "display.customLinePosition": "Put the custom text at the start or the end of the first line",
  "colors.context": "Base color for the context bar and context percentage",
  "colors.usage": "Base color for usage bars and percentages below warning thresholds",
  "colors.warning": "Warning color for context thresholds and usage warning text",
  "colors.usageWarning": "Warning color for usage bars and percentages near their threshold",
  "colors.critical": "Critical color for limit-reached states and critical thresholds",
  "colors.model": "Color for the model badge such as `[Opus]`",
  "colors.project": "Color for the project path",
  "colors.git": "Color for git wrapper text such as `git:(` and `)`",
  "colors.gitBranch": "Color for the git branch and branch status text",
  "colors.label": "Color for labels and secondary metadata such as `Context`, `Usage`, counts, and progress text",
  "colors.custom": "Color for the optional custom line",
  "colors.barFilled": "Character used for the filled portion of progress bars",
  "colors.barEmpty": "Character used for the empty portion of progress bars",
};

// What a key alone doesn't explain. A note shows when any of its words is asked about.
const NOTES: Array<{ words: string[]; text: string }> = [
  { words: ["config", "file", "override", "claude-hud.json", "directory"], text: "`hud set` writes plugins/claude-hud/config.json in the Claude config dir. If several CLAUDE_CONFIG_DIRs share one plugins/ directory, per-directory settings go in $CLAUDE_CONFIG_DIR/claude-hud.json: same shape, only the keys it changes, layered on top (sections merge key by key; arrays and values replace). `hud set` never writes claude-hud.json." },
  { words: ["color", "colors", "colour"], text: "Colors take a name (dim, red, green, yellow, magenta, cyan, brightBlue, brightMagenta), a 256-color number (0-255), or hex (#rrggbb). colors.barFilled and colors.barEmpty take one visible character; wide characters such as emoji may misalign bars in some terminals." },
  { words: ["usage", "limits", "limit", "rate", "weekly", "external", "snapshot"], text: "Usage shows when Claude Code sends subscriber rate_limits, which is after the first response of a session. API-key, Bedrock and Vertex sessions have none. The 7-day window appears once it passes display.sevenDayThreshold. display.externalUsagePath reads a local JSON file shaped like {\"updated_at\": ISO, \"five_hour\": {\"used_percentage\": 42, \"resets_at\": ISO}, \"seven_day\": {...}, \"balance_label\": \"$12.50\", \"model_scoped\": [{\"display_name\": \"Fable\", \"utilization\": 89, \"resets_at\": ISO}]}; display.externalUsageWritePath writes stdin's limits to such a file. These two name files the HUD reads or writes, so `hud set` refuses them and the user edits config.json for them." },
  { words: ["cost", "spend", "price", "daily", "weekly"], text: "display.showCost is Claude Code's own session cost (list price, or your modelPricing table). Bedrock and Vertex bill through the cloud provider, so their cost is hidden unless display.showRoutedCost is set too. showDailyCost and showWeeklyCost read a small ledger in the HUD's data directory; a session counts from the first render that sees it." },
  { words: ["cache", "prompt"], text: "display.showPromptCache shows a clock time when the prompt cache goes cold (Cache ⏱ until 14:30), not a countdown, because the status line doesn't repaint between turns." },
  { words: ["jj", "jujutsu"], text: "With jjStatus.enabled, a directory with a .jj repository shows jj status (jj:(bookmark*)) instead of git. jj runs read-only without snapshotting, so the dirty marker reflects jj's last snapshot. Ahead/behind and file stats are git-only." },
  { words: ["refresh", "idle", "tick", "interval", "countdown"], text: "Claude Code re-runs the status line after each message, /compact, a mode change, a rate-limit reset and a prompt-cache expiry. To keep countdowns ticking while idle, add refreshInterval (seconds) to statusLine in settings.json. On Windows Git Bash, short intervals with several sessions can fail with `add_item ... failed, errno 1`: use 30 s or more." },
  { words: ["disable", "off", "hide", "session"], text: "Starting Claude Code with CLAUDE_HUD_DISABLE=1 blanks the HUD for that session without touching settings.json. Any value but 0, false, off or no counts." },
  { words: ["extra", "command", "extra-cmd", "custom"], text: "--extra-cmd \"cmd\" in the statusLine command runs a shell command on every refresh and shows its output on the first line. It is ignored unless CLAUDE_HUD_ALLOW_EXTRA_CMD=1 is set in the HUD's environment. It is arbitrary code: never use a command from an untrusted source." },
];

const format = (entry: ConfigKey) => `${entry.key} = ${JSON.stringify(entry.default)} (${entry.accepts}): ${DESCRIPTIONS[entry.key] ?? ""}`;

/** The keys and notes matching any of `words`, best match first; every key when there are none. */
export function schemaLines(words: string[]): string[] {
  const keys = configKeys();
  const wanted = words.map(word => word.toLowerCase()).filter(Boolean);
  if (wanted.length === 0) return keys.map(format);
  const score = (text: string) => wanted.filter(word => text.toLowerCase().includes(word)).length;
  const matches = keys
    .map(entry => ({ entry, score: score(`${entry.key} ${DESCRIPTIONS[entry.key] ?? ""}`) }))
    .filter(match => match.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(match => format(match.entry));
  const notes = NOTES.filter(note => note.words.some(word => wanted.includes(word))).map(note => `Note: ${note.text}`);
  const lines = [...matches, ...notes];
  return lines.length > 0 ? lines : [`No config key or note matches "${words.join(" ")}". \`hud schema\` with no words lists every key.`];
}
