# Changelog

All notable changes to Claude HUD will be documented in this file.

## [Unreleased]

## [0.3.0] - 2026-03-21

### Added
- Multi-session detection — PID-based lock files track concurrent Claude Code sessions; project line shows `⊕N` indicator when more than one session is active (`src/session-lock.ts`, `src/render/lines/project.ts`)
- Session comparison metrics — `compareWithLastSession()` computes duration, tool call count, and compact count deltas vs the previous completed session (`src/session-history.ts`)
- Dashboard export — `exportDashboard()` aggregates all session records into a JSON snapshot with summary stats; `/claude-hud:dashboard` command lets users display, copy, or save the export (`src/session-history.ts`, `commands/dashboard.md`)
- Weekly usage summary — `generateWeeklySummary()` and `formatWeeklySummary()` aggregate the past 7 days of sessions, reporting tool calls, agent runs, compacts, avg duration, most-used model, and peak context percent (`src/session-history.ts`)

## [0.2.0] - 2026-03-21

### Added
- Byte-offset incremental transcript parsing — subsequent parses only read new bytes appended since last parse, reducing I/O on large transcripts (`src/transcript.ts`)
- Smart compact auto-switch — automatically switches from expanded to compact layout when context usage reaches ≥85%; gated by `display.autoCompactSwitch` config option (default: `true`) (`src/render/index.ts`, `src/config.ts`)
- Alert history tracking — all triggered alerts recorded in a rolling 100-entry session log, deduped per type within 60-second windows; accessible via `getAlertHistory()` (`src/alert.ts`)
- Session cost prediction — projects total session cost at current burn rate, displayed inline after current cost when `showCost` and `showBurnRate` are enabled (`src/cost-tracker.ts`, `src/render/lines/identity.ts`)
- Alert hook — run a custom shell command on critical alert triggers via `alerts.hook` config; receives `CLAUDE_HUD_ALERT_TYPE` and `CLAUDE_HUD_ALERT_MESSAGE` environment variables (`src/alert.ts`, `src/config.ts`)

## [0.1.0] - 2026-03-21

### Added
- Cache layer (`src/cache.ts`) — unified file-based caching with TTL for transcript, git, and config data
- Framework providers (`src/providers/`) — AGW combo status and Agent Teams worktree monitoring
- Alert engine (`src/alert.ts`) — configurable threshold alerts with visual, bell, macOS notification, and prediction text
- Burn rate tracking (`src/burn-rate.ts`) — sliding 5-minute window token consumption rate
- Session statistics (`src/session-stats.ts`) — peak context tracking and autocompact detection
- Session history (`src/session-history.ts`) — persistent record of last 50 sessions
- Cost estimation (`src/cost-tracker.ts`) — session cost based on model pricing
- Context sparkline — mini trend chart using `▁▂▃▄▅▆▇█` characters
- Context time prediction — estimated time until autocompact based on burn rate
- Color themes — Default, Catppuccin Mocha, Dracula, Nord (`src/themes.ts`)
- Light theme variants — Catppuccin Latte, Nord Light for light terminals
- Terminal theme auto-detection via `COLORFGBG` environment variable
- Activity indicator (`◉`) — red when tools running, green when idle
- Tree prefixes (`├─` / `└─`) — hierarchical connectors for activity lines
- Modern bar characters (`▰▱`) — alternative to classic `█░`
- Todo mini progress bar (`▪▪▪▪▪`) — per-item colored status squares
- Merged tools+agents display — combined on one line for density
- Tool error rate display — `✘ N err` count in tools line
- API latency tracking — response time display with color coding
- macOS notifications for critical alerts via `osascript`
- Config import/export (`src/config-io.ts`)
- Health check diagnostics (`src/health-check.ts`)
- `/claude-hud:health` command — diagnostic health check
- `/claude-hud:export` command — config export/import/reset
- `/claude-hud:theme` command — one-click theme switching
- Benchmark script (`scripts/benchmark.sh`) — 300ms budget verification
- Shared formatting utilities (`src/utils/format.ts`)

### Changed
- Bar renderers accept `barStyle` parameter (`classic` or `modern`)
- Context/usage color thresholds configurable via alert config (threshold unification)
- Usage 5h/7d separator changed from `|` to `│` for visual consistency
- Responsive terminal adaptation — 3-layer system (content reduction → progressive hiding → character wrap)
- Content never truncated with `...` — wraps to next line instead
- `getTerminalWidth()` moved to shared `src/utils/terminal.ts`
- `colorize()` exported from `src/render/colors.ts`
- `HudElement` type extended with `'framework'` and `'alert'`
- `RenderContext` extended with frameworkStatus, alerts, burnRate, sessionStats, sparkline, costEstimate, apiLatency, terminalWidth

### Fixed
- `barStyle` config not passed through to `coloredBar()` / `quotaBar()` calls
- Autocompact detection false positives — now requires sustained drop across 2+ readings

---

## [0.0.10] - 2026-03-14

### Added
- Semantic HUD color overrides for context and usage states.

### Changed
- Update the fallback autocompact buffer estimate from `22.5%` (`45k/200k`) to `16.5%` (`33k/200k`) to match current Claude Code `/context` output.
- Clarify in code comments that the fallback buffer is empirical and may change independently of documented Claude Code releases.
- Clarify that context percentages and token displays scale with Claude Code's reported context window size, including newer 1M-context sessions.
- Text-only usage display now shows the 7-day reset countdown when applicable.
- Rate-limited usage refreshes now keep the last successful values visible while marking the HUD as syncing.

### Fixed
- Context percentage no longer starts with an inflated fallback percentage before native data exists.
- Usage API rate-limit handling is more resilient, including better stale-cache behavior and `Retry-After` parsing.
- Zero-byte usage lock files now recover instead of leaving the HUD permanently busy.
- Plugin selection now prefers the highest installed version instead of filesystem mtime.
- macOS Keychain lookup now prefers account-scoped credentials and avoids cross-account fallback when multiple accounts exist.

---

## [0.0.9] - 2026-03-05

### Changed
- Add Usage API timeout override via `CLAUDE_HUD_USAGE_TIMEOUT_MS` (default now 15s).

### Fixed
- Setup instructions now generate shell-safe Windows commands for `win32 + bash` environments (#121, #148).
- Bedrock startup model labels now normalize known model IDs when `model.display_name` is missing (#137).
- Usage API reliability improvements for proxy and OAuth token-refresh edge cases:
  - Respect `HTTPS_PROXY`/`ALL_PROXY`/`HTTP_PROXY` with `NO_PROXY` bypass.
  - Preserve usage and plan display when keychain tokens refresh without `subscriptionType` metadata.
  - Reduce false `timeout`/`403` usage warnings in proxied and high-latency environments (#146, #161, #162).
- Render output now preserves regular spaces instead of non-breaking spaces to avoid vertical statusline rendering issues on startup (#142).

---

## [0.0.8] - 2026-03-03

### Added
- Session name display in the statusline (#155).
- `display.contextValue: "remaining"` mode to show remaining context percent (#157).
- Regression tests for `CLAUDE_CONFIG_DIR` path handling, keychain service resolution fallback ordering, and config counter overlap edge cases.

### Changed
- Prefer subscription plan labels over API env-var detection for account type display (#158).
- Usage reset time formatting now switches to days when the reset window is 24h or more (#132).

### Fixed
- Respect `CLAUDE_CONFIG_DIR` for HUD config lookup, usage cache, speed cache, and legacy credentials file paths (#126).
- Improve macOS Keychain credential lookup for multi-profile setups by using profile-specific service names with compatibility fallbacks.
- Fix config counting overlap detection so project `.claude` files are still counted when `cwd` is home and user scope is redirected.
- Prevent HUD rows from disappearing in narrow terminals (#159).
- Handle object-based legacy layout values safely during config migration (#144).
- Prevent double-counting user vs project `CLAUDE.md` when `cwd` is home (#141).

### Dependencies
- Bump `@types/node` from `25.2.3` to `25.3.3` (#153).
- Bump `c8` from `10.1.3` to `11.0.0` (#154).

---

## [0.0.7] - 2026-02-06

### Changed
- **Redesigned default layout** — clean 2-line display replaces the previous multi-line default
  - Line 1: `[Opus | Max] │ my-project git:(main*)`
  - Line 2: `Context █████░░░░░ 45% │ Usage ██░░░░░░░░ 25% (1h 30m / 5h)`
- Model bracket moved to project line (line 1)
- Context and usage bars combined onto a single line with `│` separator
- Shortened labels: "Context Window" → "Context", "Usage Limits" → "Usage"
- Consistent `dim()` styling on both labels
- All optional features hidden by default: tools, agents, todos, duration, config counts
- Bedrock provider detection (#111)
- Output speed display (#110)
- Token context display option (#108)
- Seven-day usage threshold config (#107)

### Added
- Setup onboarding now offers optional features (tools, agents & todos, session info) before finishing
- `display.showSpeed` config option for output token speed

### Fixed
- Show API failure reason in usage display (#109)
- Support task todo updates in transcript parsing (#106)
- Keep HUD to one line in compact mode (#105)
- Use Platform context instead of uname for setup detection (#95)

---

## [0.0.6] - 2026-01-14

### Added
- **Expanded multi-line layout mode** - splits the overloaded session line into semantic lines (#76)
  - Identity line: model, plan, context bar, duration
  - Project line: path, git status
  - Environment line: config counts (CLAUDE.md, rules, MCPs, hooks)
  - Usage line: rate limits with reset times
- New config options:
  - `lineLayout`: `'compact'` | `'expanded'` (default: `'expanded'` for new users)
  - `showSeparators`: boolean (orthogonal to layout)
  - `display.usageThreshold`: show usage line only when >= N%
  - `display.environmentThreshold`: show env line only when counts >= N

### Changed
- Default layout is now `expanded` for new installations
- Threshold logic uses `max(5h, 7d)` to ensure high 7-day usage isn't hidden

### Fixed
- Ghost installation detection and cleanup in setup command (#75)

### Migration
- Existing configs with `layout: "default"` automatically migrate to `lineLayout: "compact"`
- Existing configs with `layout: "separators"` migrate to `lineLayout: "compact"` + `showSeparators: true`

---

## [0.0.5] - 2026-01-14

### Added
- Native context percentage support for Claude Code v2.1.6+
  - Uses `used_percentage` field from stdin when available (accurate, matches `/context`)
  - Automatic fallback to manual calculation for older versions
  - Handles edge cases: NaN, negative values, values >100
- `display.autocompactBuffer` config option (`'enabled'` | `'disabled'`, default: `'enabled'`)
  - `'enabled'`: Shows buffered % (matches `/context` when autocompact ON) - **default**
  - `'disabled'`: Shows raw % (matches `/context` when autocompact OFF)
- EXDEV cross-device error detection for Linux plugin installation (#53)

### Changed
- Context percentage now uses percentage-based buffer (22.5%) instead of hardcoded 45k tokens (#55)
  - Scales correctly for enterprise context windows (>200k)
- Remove automatic PR review workflow (#67)

### Fixed
- Git status: move `--no-optional-locks` to correct position as global git option (#65)
- Prevent stale `index.lock` files during git operations (#63)
- Exclude disabled MCP servers from count (#47)
- Reconvert Date objects when reading from usage API cache (#45)

### Credits
- Ideas from [#30](https://github.com/jarrodwatts/claude-hud/pull/30) ([@r-firpo](https://github.com/r-firpo)), [#43](https://github.com/jarrodwatts/claude-hud/pull/43) ([@yansircc](https://github.com/yansircc)), [#49](https://github.com/jarrodwatts/claude-hud/pull/49) ([@StephenJoshii](https://github.com/StephenJoshii)) informed the autocompact solution

### Dependencies
- Bump @types/node from 25.0.3 to 25.0.6 (#61)

---

## [0.0.4] - 2026-01-07

### Added
- Configuration system via `~/.claude/plugins/claude-hud/config.json`
- Interactive `/claude-hud:configure` skill for in-Claude configuration
- Usage API integration showing 5h/7d rate limits (Pro/Max/Team)
- Git status with dirty indicator and ahead/behind counts
- Configurable path levels (1-3 directory segments)
- Layout options: default and separators
- Display toggles for all HUD elements

### Fixed
- Git status spacing: `main*↑2↓1` → `main* ↑2 ↓1`
- Root path rendering: show `/` instead of empty
- Windows path normalization

### Credits
- Config system, layouts, path levels, git toggle by @Tsopic (#32)
- Usage API, configure skill, bug fixes by @melon-hub (#34)

---

## [0.0.3] - 2025-01-06

### Added
- Display git branch name in session line (#23)
- Display project folder name in session line (#18)
- Dynamic platform and runtime detection in setup command (#24)

### Changed
- Remove redundant COMPACT warning at high context usage (#27)

### Fixed
- Skip auto-review for fork PRs to prevent CI failures (#25)

### Dependencies
- Bump @types/node from 20.19.27 to 25.0.3 (#2)

---

## [0.0.2] - 2025-01-04

### Security
- Add CI workflow to build dist/ after merge - closes attack vector where malicious code could be injected via compiled output in PRs
- Remove dist/ from git tracking - PRs now contain source only, CI handles compilation

### Fixed
- Add 45k token autocompact buffer to context percentage calculation - now matches `/context` output accurately by accounting for Claude Code's reserved autocompact space
- Fix CI caching with package-lock.json
- Use Opus 4.5 for GitHub Actions code review

### Changed
- Setup command now auto-detects installed plugin version (no manual path updates needed)
- Setup prompts for optional GitHub star after successful configuration
- Remove husky pre-commit hook (CI now handles dist/ compilation)

### Dependencies
- Bump c8 from 9.1.0 to 10.1.3

---

## [0.0.1] - 2025-01-04

Initial release of Claude HUD as a Claude Code statusline plugin.

### Features
- Real-time context usage monitoring with color-coded progress bar
- Active tool tracking with completion counts
- Running agent status with elapsed time
- Todo progress display
- Native token data from Claude Code stdin
- Transcript parsing for tool/agent/todo activity
