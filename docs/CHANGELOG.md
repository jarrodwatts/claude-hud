# Changelog

All notable changes to claude-hud will be documented in this file.

## [2.0.9] - 2026-01-03

### Improved
- **Performance**: Added React.memo to SessionStats component
  - All components now consistently wrapped with React.memo

### Fixed
- **Documentation**: Removed broken screenshot reference from README

---

## [2.0.8] - 2026-01-03

### Improved
- **Test coverage**: Increased to 94.25% (231 total tests)
  - ToolStream now at 100% line coverage
  - Added edge case tests for path truncation
- **Code quality**: Removed dead code from truncatePath function

---

## [2.0.7] - 2026-01-03

### Improved
- **Performance**: Added React.memo to McpStatus and ModifiedFiles components
- **Debugging**: ErrorBoundary now logs errors via logger utility

---

## [2.0.6] - 2026-01-03

### Improved
- **Documentation**: Updated CONTRIBUTING.md with v2.0 architecture
  - Added coverage, lint, typecheck, format commands
  - Documented useHudState as central state management
  - Updated project structure with new files
  - Added Code Style section with quality tools

---

## [2.0.5] - 2026-01-03

### Improved
- **Test coverage**: Increased to 94.00% (229 total tests)
  - Added ContextMeter tests (header, percentage, compact warning, number formatting)
  - Added settings-reader edge case tests (invalid JSON, missing fields)

---

## [2.0.4] - 2026-01-03

### Improved
- **Test coverage**: Increased to 93.92% (218 total tests)
  - Added SessionStats hours format test
  - Added transcript-reader invalidate test
  - Added AgentList edge case tests (filename-only targets, truncation, empty targets)
  - Added context-detector edge case tests (missing permissions, undefined cwd)

---

## [2.0.3] - 2026-01-03

### Improved
- **Test coverage**: Increased to 93.64% (210 total tests)
  - Added StatusBar.test.tsx with truncatePath tests
  - Added ToolStream edge case tests for path truncation
  - Added context-tracker tests for addMessageTokens and getContextState

---

## [2.0.2] - 2026-01-03

### Improved
- **Test coverage**: Increased to 92%+ (192 total tests)
  - Added ErrorBoundary tests for error rendering
  - Added event-reader tests for getLastEventTime() and switchFifo()
  - Added usage-reader tests for invalidate() and edge cases
- **Performance**: Added React.memo to all remaining components
  - TodoList, Sparkline, AgentList, StatusBar, ContextInfo now memoized
  - Moved all helper functions outside component bodies

### Removed
- Unused GitStatus component

---

## [2.0.1] - 2026-01-03

### Added
- **Debug logging**: Proper error logging via `CLAUDE_HUD_DEBUG=1`
  - Logger utility with debug/warn/error levels
  - Replaces all silent catch blocks with logged errors
- **GitHub Actions CI**: Automated lint, typecheck, test, and build on push/PR
  - Plugin structure validation (plugin.json, hooks.json, scripts)
  - Note: Requires `workflow` scope on GitHub token to push

### Fixed
- **Agent tools tracking**: Agent tools array now populates correctly
  - Tools tracked per-agent and limited to last 5 calls
  - Excludes Task tool itself from tracking

### Improved
- **Test coverage**: Increased from 82% to 90%+ (31 new tests)
  - Added tests for logger, ContextInfo, useElapsedTime, StatsReader
- **Performance**: Added React.memo to prevent unnecessary re-renders
  - Wrapped ContextMeter, ToolStream, CostDisplay
  - Moved helper functions outside component bodies

### Removed
- Unused components: Edits.tsx, RateLimitMeter.tsx
- Unused types: AppState interface
- Unused exports: readStats() now internal-only

---

## [2.0.0] - 2026-01-02

### Architecture Overhaul

A complete rewrite focusing on stability, accuracy, and developer experience.

### Added
- **UnifiedContextTracker**: Single source of truth for context tracking
  - Reads real token counts from Claude transcript files
  - Falls back to estimation when transcript unavailable
  - Eliminates flickering from dual data sources
- **CostDisplay**: Real-time API cost estimation
  - Tracks input/output tokens separately
  - Automatic model detection for accurate pricing
  - Supports Opus, Sonnet, and Haiku pricing
- **Custom hooks architecture**:
  - `useHudState` - Centralized state management
  - `useElapsedTime` - Session timer hook
- **Code quality tooling**:
  - ESLint with TypeScript, React, and React Hooks rules
  - Prettier with consistent formatting
  - Husky pre-commit hooks with lint-staged
- **Comprehensive test suite**: 152 tests covering all components

### Changed
- **app.tsx**: Reduced from 329 lines to 136 lines (59% reduction)
- **Context tracking**: Reads transcript on Stop events only, not polling
- **State management**: Follows ADR 001 pattern with custom hooks

### Fixed
- **Context flickering**: Eliminated dual-source updates
- **Session handling**: Proper transcript path detection on /resume
- **Test reliability**: Fixed race condition in smoke tests

### Technical
- Added Architecture Decision Records (ADRs):
  - ADR 001: State management via custom hooks
  - ADR 002: Event-driven data flow with minimal polling
  - ADR 003: Minimal shell scripts, logic in TypeScript
  - ADR 004: Session ID tracking for graceful transitions
- Research documented in `docs/research/RESEARCH.md`

## [1.0.0] - Initial Release

- Context meter with sparkline
- Tool stream with live status
- Agent tracking
- Todo list display
- Session statistics
- Git status panel
- MCP server status
