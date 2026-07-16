# Changelog

All notable changes to Claude HUD will be documented in this file.

## [Unreleased]

## [0.5.1] - 2026-07-17

### Fixed
- Align context, usage, and opt-in memory progress bars by terminal cell width in CJK locales, including merged and narrow layouts (#673).

## [0.5.0] - 2026-07-16

### Added
- Render bounded model-scoped weekly usage windows from Claude Code statusline input in expanded and compact layouts, including remaining-value, reset-time, threshold, and custom-color modes (#669).

### Security
- Sanitize and bound model-scoped usage labels and values before terminal rendering, and keep scoped-only input from overwriting shared external usage snapshots (#669).
- Clean compiled output before every build and enforce source-to-artifact parity so removed modules cannot remain in release packages (#670).

## [0.4.2] - 2026-07-15

### Fixed
- Show a useful git ref for detached HEAD sessions by preferring exact tags and falling back to a linked short commit label (#664).
- Preserve slash-separated branch names in GitHub branch links so clicking the HUD branch opens the expected remote branch (#664).
- Allow opt-in `--extra-cmd` hooks to use the last non-empty line of sanitized plain-text output in addition to JSON labels (#664).
- Strip control and bidirectional characters from Git refs in compact rendering (#664).

## [0.4.1] - 2026-07-14

### Fixed
- Restore the default 80% weekly-usage threshold when the setting is omitted or invalid, preventing the weekly segment from appearing at 0% while preserving the existing usage and environment defaults (#662).

## [0.4.0] - 2026-07-13

### Added
- Add opt-in routed-provider cost display for Bedrock and Vertex sessions, with explicit native-versus-estimated labeling (#648).
- Add opt-in authentication method and account display with terminal-safe truncation and active API-key precedence (#652).
- Add Traditional Chinese (`zh-Hant` / `zh-TW`) across configuration, onboarding, and rendered labels (#645).
- Add opt-in transcript and automatic model-source modes for proxy users, with bounded terminal-safe model labels (#643).

### Changed
- Show ultracode sessions as `ultracode(xhigh)` from transcript attachment and `/effort` signals (#640).
- Move locale-specific time layout into named interpolation patterns so translations control word order and spacing (#647).
- Keep effort suffixes attached to model names and enforce opt-in render guards consistently (#650).

### Fixed
- Deduplicate repeated assistant usage by bounded message IDs while preserving the idless transcript fallback (#646).
- Show cache creation and cache read tokens in compact session-token summaries (#653).
- Count symlinked rule files and directories with cycle-safe, bounded traversal and cache invalidation (#644).
- Handle non-ASCII checkout paths correctly in direct-entrypoint tests (#655).

### Removed
- Drop the `ps`-based parent-process `--effort` fallback (#471); the effort label now comes solely from Claude Code's stdin, which carries the level directly.

### Dependencies
- Bump `@types/node` from 25.9.3 to 26.1.1 (#657).
- Bump TypeScript from 6.0.3 to 7.0.2 (#656).

## [0.3.0] - 2026-06-19

### Added
- Add `display.showProvider` and `display.providerName` so custom proxy users can optionally show provider labels before the model name in compact and expanded layouts (#629).

### Changed
- Extract shared model badge formatting so compact and expanded layouts keep provider labels and effort suffixes consistent (#629).

### Fixed
- Harden and document external usage snapshot read paths as absolute-only, with focused regression coverage for relative-path rejection (#637).
- Add regression coverage for private `speed-cache` directory and cache file permissions introduced by the cache hardening work (#637).

## [0.2.1] - 2026-06-18

### Fixed
- Require explicit `CLAUDE_HUD_ALLOW_EXTRA_CMD` opt-in before running `--extra-cmd`, and document the local command trust boundary (#619).
- Merge missing seven-day usage from a configured external snapshot when stdin only supplies the five-hour usage window (#617).
- Correct Opus 4.5+ local cost estimates to the current standard Anthropic rate while keeping older Opus 4.0/4.1 pricing unchanged (#625).

## [0.2.0] - 2026-06-15

### Added
- Add opt-in session compaction count display from reliable transcript `compact_boundary` entries (#609).
- Add `CLAUDE_HUD_DISABLE` as a per-session environment kill switch that exits before stdin, transcript, config, or git work (#610).

### Changed
- Sync `/claude-hud:configure` documentation with current display options, including compaction count, Skills, MCP, prompt cache, memory, cost, and reset-label controls (#613).

### Dependencies
- Bump `@types/node` from 25.9.2 to 25.9.3 (#614).

## [0.1.1] - 2026-06-09

### Added
- Add default-off Skills and MCP activity lines, with sanitized active names and Skill-tool suppression when the Skills line is enabled (#527, #595).
- Add optional advisor model display with sanitized transcript-derived and override labels (#573).
- Add `display.autoCompactWindow` support for context denominator calculations, including token-display denominator handling (#589).

### Fixed
- Render external `balance_label` values alongside stdin `rate_limits` instead of treating them as mutually exclusive (#598, #599).
- Preserve inherited terminal width in setup-generated statusline commands before probing `/dev/tty`, fixing narrow-pane wrapping/flicker in terminals without a controlling TTY (#581).
- Use a lightweight Windows Node launcher for PowerShell/cmd setup instead of a PowerShell wrapper on every statusline refresh, reducing Windows render-time overhead while preserving update discovery (#555).
- Collapse whitespace in multiline Bash tool targets before truncation so the tools line stays single-line (#594).
- Harden advisor, Skills, and MCP labels against control characters, terminal escapes, bidi controls, and oversized activity names (#573, #595).
- Validate `autoCompactWindow` as an integer before using it in context calculations (#589).

### Changed
- Clarify in release docs that `.claude-plugin/plugin.json` is the Claude Code update/cache version source (#591).

### Dependencies
- Bump `@types/node` from 25.9.1 to 25.9.2 (#593).
- Refresh the lockfile to clear the transitive `brace-expansion` audit advisory.

## [0.1.0] - 2026-06-03

### Added
- Effort-level display in the model bracket (#471).
- Native stdin `cost.total_cost_usd` support, external usage snapshot fallback, prompt-cache countdown, and optional JSON snapshots for stdin `rate_limits` (#381, #477, #478, #570).
- Vertex AI provider detection with cost estimation disabled for Vertex sessions (#479).
- Usage display controls for reset labels, absolute/relative reset times, compact display, remaining mode, elapsed/percentage mode, and third-party balance labels (#415, #421, #433, #536, #541, #572).
- Layout and configuration controls for expanded merge groups, wrapped branch display, terminal width fallbacks, `/add-dir` workspace directories, progress bar colors, tool name wrapping/truncation, and custom line placement (#474, #476, #501, #502, #505, #571, #575).
- Session start date, last response timestamp, and Skill tool target display (#497, #537).

### Changed
- Setup is more defensive around marketplace install paths, Windows runtime guidance, Git Bash/MSYS routing, existing statusline backups, and PowerShell wrapper generation (#399, #473, #532, #538, #546, #567).
- Rendering now handles narrow terminals, unknown terminal widths, CJK ambiguous-width glyphs, branch links, progress-label padding, OSC 8 hyperlinks, and tool wrapping more consistently (#427, #439, #443, #489, #509, #518, #561, #571).
- Chinese documentation was added and later synced with the English README (#435, #557).

### Fixed
- Bounded stdin reads to prevent statusline hangs (#378).
- Context and cache behavior for initial zero-percent frames, post-compact resets, live zero-percent usage, nonzero token totals with zero usage, and fallback todo rendering (#430, #460, #492, #508, #579).
- Transcript and task state handling for default subagent labels, duplicate-content `TodoWrite` task IDs, background-agent timing, stale transcript agent caches, and adjacent session usage deduplication (#455, #456, #515, #560, #579).
- Git and render correctness for renamed files, quoted arrow filenames, Unicode paths, line diffs, and OSC link truncation (#451, #543, #561).
- Platform-specific behavior for Bedrock provider labels, Linux memory parsing, Windows console flashes, unsafe progress-bar code points, and PowerShell setup output (#468, #523, #567).
- Speed and cost display edge cases, including native cost fallback, speed cache scoping, short-window accumulation, Claude Haiku 4.x pricing, enterprise aliases, and effort schema changes (#440, #453, #486, #491, #496).
- Windows + PowerShell `/claude-hud:setup` now writes a `statusline.ps1` wrapper with a guarded width fallback and corrected version-directory glob (#521).
- Added Windows PowerShell 5.1 guidance for writing `settings.json` without a UTF-8 BOM.

### Dependencies
- Bumped TypeScript and `@types/node` development dependencies across the 0.1.0 cycle (#383, #426, #465, #533, #554, #565).

## [0.0.12] - 2026-04-04

### Added
- Chinese (`zh`) HUD labels as an explicit opt-in, while keeping English as the default.
- Guided language selection in `/claude-hud:configure` so users can choose English or Chinese without hand-editing JSON.
- Offline estimated session cost display via `display.showCost` for known Anthropic model families, derived from local transcript token usage only.
- Session token totals, output-style display, git push count threshold coloring, configurable model badge formatting, and a custom model override.
- Git file diff rendering with per-file and total line deltas, plus clickable OSC 8 file links where supported.

### Changed
- Usage display now relies only on Claude Code's official stdin `rate_limits` fields. Background OAuth usage polling, related cache/lock behavior, and credential-derived subscriber plan labels were removed.
- Setup and configure flows now better support simple onboarding: Windows setup prefers Node.js guidance, the GitHub star prompt includes `gh` compatibility guidance, and configure now exposes language as a first-class guided choice.
- Plugin detection, config caching, and transcript-derived activity/session metadata are more robust and better covered by tests.

### Fixed
- Stabilize Claude Code version cache behavior across resolved binary paths and mtimes, fixing Node 20 CI failures.
- Stop guessing auth mode from environment variables alone.
- Preserve task IDs across `TodoWrite`, detect transcript agents recorded as `Agent`, and improve narrow-terminal wrapping including OSC hyperlink width handling.
- Improve macOS memory reporting, config cache invalidation, and fallback rendering when terminal width is unavailable.
- Clarify official usage-data behavior and keep Bedrock/unknown pricing cases hidden rather than showing misleading estimates.

## [0.0.10] - 2026-03-23

### Added
- Configurable HUD color overrides, including named presets, 256-color indices, and hex values.
- `display.customLine` support for a short custom phrase in the HUD.
- New opt-in display toggles for session name, combined context mode (`display.contextValue: "both"`), Claude Code version, and approximate system RAM usage in expanded layout.

### Changed
- Setup and plugin detection now better handle `CLAUDE_CONFIG_DIR`, Windows shell quoting, and Bun `--env-file` installs without inheriting project environment files.
- Usage display now prefers Claude Code stdin `rate_limits` data when available, still falls back to the existing OAuth/cache path, and presents weekly-only/free-user usage more cleanly.
- Context percentages and token displays now follow Claude Code's reported context window size, including newer 1M-context sessions, with a lower fallback autocompact estimate that better matches `/context`.
- Usage text output now keeps the last successful values visible while syncing, shows the 7-day reset countdown when applicable, and clarifies that standard proxy environment variables are the supported way to route Anthropic traffic.
- Progress bars and expanded-layout output now adapt more cleanly to narrow terminal widths.

### Fixed
- Setup is more reliable in sessions that previously failed to surface the HUD until Claude Code restarted, and plugin command discovery no longer fails with unknown-skill errors after install.
- Usage handling is more resilient under OAuth token refreshes, proxy tunnels, explicit TLS overrides, zero-byte lock files, stale-cache recovery, and rate-limit edge cases that previously caused repeated `429` or syncing failures.
- Account-scoped credential lookup and plugin selection are more reliable for multi-account setups and multiple installed plugin versions.
- Expanded-layout rendering now preserves speed, duration, extra labels, and weekly-only usage output correctly.
- Tool execution no longer scrolls the terminal to the top, and transcript reparsing now avoids repeatedly caching partial parse results on large histories.

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
