# Changelog

All notable changes to Claude HUD will be documented in this file.

## [Unreleased]

### Fixed
- Context percentage now matches Claude Code's `/context` output exactly (raw token usage)
- Previously inflated by 23% after compactions due to hardcoded 45k buffer

### Changed
- Warnings (yellow/red colors, token breakdown, COMPACT indicator) now trigger based on "compact risk" (raw + 45k buffer) while displaying raw percent
- When approaching compact risk threshold (85%+), shows remaining headroom: `65% (in: 10, cache: 130k) (12% until auto-compact if enabled)`
- This gives users advance warning of autocompact while showing accurate current usage

---

## [0.0.2] - 2025-01-04

### Security
- Add CI workflow to build dist/ after merge - closes attack vector where malicious code could be injected via compiled output in PRs
- Remove dist/ from git tracking - PRs now contain source only, CI handles compilation

### Fixed
- ~~Add 45k token autocompact buffer to context percentage calculation~~ (reverted in next release)
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
