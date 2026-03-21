# Claude HUD Enhancement Design

**Date**: 2026-03-21
**Status**: Draft
**Approach**: Incremental Enhancement (Option A) — upstream-friendly, backward-compatible

## Overview

Comprehensive enhancement of claude-hud across 5 areas: performance, display content, framework integration, visual style, and feature expansion. All changes are opt-in via config, maintaining backward compatibility for upstream PR submission.

## 1. Performance — Cache Layer

### Problem

Every 300ms invocation spawns a new process that re-parses the entire transcript JSONL, runs up to 3 git execFile commands (each with 1s timeout), and re-reads config files.

### Solution

New module `src/cache.ts` providing a unified file-based cache with TTL management.

```
src/cache.ts
├── readCache<T>(key, ttlMs) → T | null
├── writeCache<T>(key, data) → void
└── cacheDir: ~/.claude/plugins/claude-hud/.cache/
```

**Design note**: Since each invocation is a new process (no shared memory), file-based caching is the only option. To minimize syscalls, all cache entries are stored in a single JSON file (`cache.json`) with per-key timestamps, reducing the overhead to one `stat` + one `readFile` per invocation.

#### Cache Strategy

| Data Source | Cache Key | TTL | Invalidation |
|------------|-----------|-----|--------------|
| Transcript parse | `transcript` | 500ms | File mtime change |
| Git status | `git-status` | 2s | Fixed TTL |
| Git ahead/behind | `git-remote` | 10s | Fixed TTL |
| Config | `config` | 5s | Fixed TTL |
| MCP/rules count | `config-counts` | 30s | Fixed TTL |

#### Transcript Incremental Parsing

- Record last-read byte offset in cache
- On next invocation, only read bytes after the offset
- Merge new tool/agent/todo entries into cached `TranscriptData`
- Full re-parse triggers:
  - Offset > current file size (file was truncated/rotated)
  - Content at previous offset doesn't match expected continuation
- **Partial line handling**: Buffer the last incomplete line (no trailing `\n`) and prepend it to the next read
- **Assumption**: Transcript file is append-only during normal operation; autocompact may cause truncation, which triggers full re-parse

#### Expected Performance

- Cold start: ~50ms (single cache file read + parse)
- Hot path (all caches valid): ~5-10ms (one file read, JSON.parse, validity checks)
- Git operations reduced from 3 execFile per invocation to 0 (cache hit)

## 2. Display Content — Framework Provider System

### Architecture

New directory `src/providers/` with a pluggable provider interface.

```
src/providers/
├── index.ts                  // Provider interface + loader
├── agw-provider.ts           // AGW combo status
└── agent-teams-provider.ts   // Agent Teams worktree status
```

### Provider Interface

```typescript
interface FrameworkProvider {
  name: string;
  isAvailable(): boolean;
  fetch(): FrameworkStatus | null;
}

interface FrameworkStatus {
  provider: string;
  entries: FrameworkEntry[];
}

interface FrameworkEntry {
  label: string;
  status: 'running' | 'completed' | 'error' | 'waiting';
  progress?: string;
  detail?: string;
}
```

### AGW Provider

- **Detection**: `GET http://localhost:<port>/health` (200ms timeout)
- **Data**: `GET /combos` for active combo list
- **Cache TTL**: 3s (success), 10s (failure — prevents repeated slow requests)
- **Failure**: Silent skip (no error display)
- **Error boundary**: All provider fetch/render calls wrapped in try/catch; malformed data returns null

### Agent Teams Provider

- **Detection**: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` env var
- **Data**: `git worktree list --porcelain` + per-worktree transcript scan
- **Cache TTL**: 5s
- **Display**: Branch name, status symbol, last activity

### Rendering

New file `src/render/framework-line.ts`:

```
Active:    ├─ ⟳ AGW: review-loop (3/5) │ ⬡ Teams: fe✓ be◐ test⏳
Inactive:  (line hidden)
```

### Config

```json
{
  "display": { "showFrameworks": true },
  "frameworks": {
    "agw": { "enabled": true, "endpoint": "http://localhost:3000" },
    "agentTeams": { "enabled": true }
  }
}
```

## 3. Alert Engine

### Architecture

New module `src/alert.ts` evaluating threshold-based alerts with configurable actions.

### Alert Types

| Alert | Trigger | Prediction Example |
|-------|---------|-------------------|
| `context-warning` | context ≥ 70% | `Context 70% — ~25 tool calls to autocompact` |
| `context-critical` | context ≥ 85% | `⚠ Context 92% (in: 184k, cache: 12k) — ~8 calls` |
| `usage-5h-warning` | 5h usage ≥ 70% | `5h Usage 75% — resets 14:32 (1h 8m)` |
| `usage-5h-critical` | 5h usage ≥ 90% | `⚠ 5h Usage 93% — resets 14:32 (28m)` |
| `usage-7d-warning` | 7d usage ≥ 80% | `7d Usage 85% — resets Wed 09:00` |

### Prediction Calculation

- Track average token consumption per tool call from recent transcript data (via cache layer)
- Remaining calls = remaining tokens / average tokens per call
- Cold start: No prediction shown until 5+ tool calls accumulated

### Alert Actions

```typescript
interface AlertAction {
  visual: boolean;   // Color change (default: true)
  bell: boolean;     // Terminal bell \a (default: false)
  predict: boolean;  // Prediction text (default: true)
}
```

### Anti-Spam

- Bell fires once per alert level transition (tracked in cache)
- Resets when alert drops back below threshold (e.g., critical → warning)

### Rendering

New file `src/render/alert-line.ts`:

```
Single:    ├─ ⚠ Context 92% — ~8 calls
Multiple:  ├─ ⚠ Context 92% — ~8 calls │ Usage 89% — resets 14:32 (28m)
None:      (line hidden)
```

### Config

```json
{
  "alerts": {
    "context": {
      "warningThreshold": 70,
      "criticalThreshold": 85,
      "actions": { "visual": true, "bell": false, "predict": true }
    },
    "usage5h": {
      "warningThreshold": 70,
      "criticalThreshold": 90,
      "actions": { "visual": true, "bell": true, "predict": true }
    },
    "usage7d": {
      "warningThreshold": 80,
      "actions": { "visual": true, "bell": false, "predict": true }
    }
  }
}
```

## 4. Visual System — Dashboard Rich

### Render Pipeline Restructuring

The existing render pipeline produces lines via separate functions:
- `renderProjectLine()` → `[Opus | Max] │ my-project git:(main*)`
- `renderIdentityLine()` → `Context █████░░░░░ 45%`
- `renderUsageLine()` → `Usage ██░░░░░░░░ 25%`

The Dashboard Rich layout merges these into two consolidated lines:
- **Line 1**: Combines `renderProjectLine` output + duration display into a single identity line
- **Line 2**: Combines `renderIdentityLine` + `renderUsageLine` + burn rate into a single metrics line

Implementation: Refactor `src/render/lines/project.ts` to accept duration/activity indicator params. Refactor `src/render/lines/identity.ts` to accept usage data and render both bars. The individual render functions remain callable for `compact` layout backward compatibility — only `expanded` layout uses the merged renderers.

### Line Layout

| Line | Content | Visibility |
|------|---------|-----------|
| 1 | Identity: `◉ Opus 4.6 │ Max │ project branch* ↑2 │ ⏱ 1h 23m` | Always |
| 2 | Metrics: `▰▰▰▰▰▱▱▱▱▱ 45% ctx │ ▰▰▱▱▱▱▱▱▱▱ 25% use │ 1.2k tok/m` | Always |
| 3 | Framework: `├─ ⟳ AGW: review-loop (3/5) │ ⬡ Teams: fe✓ be◐` | Conditional |
| 4 | Activity: `├─ ◐ Edit: auth.ts │ ✓ Read ×3 │ ◐ explore [haiku]` | Conditional |
| 5 | Alert: `├─ ⚠ Context 92% — ~8 calls │ Usage 89% — resets 14:32` | Conditional |
| 6 | Todos: `└─ ▸ Fix auth bug (2/5) │ ▪▪▪▪▪` | Conditional |

### Tree Prefixes

- Lines 1-2: No prefix (always visible)
- Lines 3+: `├─` for middle lines, `└─` for the last visible line
- Prefix assignment is dynamic based on which conditional lines are active
- Togglable via `treePrefixes: false`

### Bar Characters

- `classic` (default): `█` (filled) + `░` (empty) — preserves existing visual behavior
- `modern`: `▰` (filled) + `▱` (empty) — cleaner aesthetic
- Configurable via `display.barStyle: 'classic' | 'modern'`

### Activity Indicator

`◉` on Line 1:
- Red: tool currently running
- Green: idle
- Togglable via `activityIndicator: true`

### Tools + Agents Merge

Tools and agents rendered on one line (Line 4) instead of separate lines:
- Tools first, then agents appended with different icon
- Togglable via `mergeToolsAgents: false` to restore separate lines

### Color Specification

| Element | Color | Condition |
|---------|-------|-----------|
| Model name | cyan / brightBlue | — |
| Plan name | green | — |
| Branch | purple | — |
| Dirty indicator | yellow | — |
| Context bar | green | <70% |
| Context bar | yellow | 70-85% |
| Context bar | red | >85% |
| Usage bar | brightBlue | <70% |
| Usage bar | orange / brightMagenta | 70-90% |
| Usage bar | red | >90% |
| AGW icon/text | orange | — |
| Agent Teams icon | green | — |
| Separators `│` | dim gray | — |
| Secondary text | gray | — |
| Alert text | red | — |

All colors overridable via `colors.*` config (named / 256-index / hex).

**Threshold unification**: The alert thresholds (Section 3) drive both the bar color changes AND the alert line. The existing hardcoded 70/85% thresholds in `getContextColor` (`src/render/colors.ts`) will be replaced by reading from alert config, ensuring visual state and alert state always agree.

### Todo Mini Progress Bar

```
▸ Fix auth bug (2/5) │ ▪▪▪▪▪
```

Each `▪` represents one todo item from the `todos` array. Color is based on that item's individual status:
- Green (`▪`): `completed`
- Orange (`▪`): `in_progress`
- Dim (`▪`): `pending`

Order follows the todo array order. If there are more than 10 todos, show the first 10 with `…` suffix.

## 5. Feature Expansion

### Burn Rate

New module `src/burn-rate.ts` (separate from the existing `src/speed-tracker.ts` which tracks output token speed; burn-rate tracks input token consumption rate for prediction purposes):

```typescript
interface BurnRate {
  tokensPerMinute: number;
  estimatedCallsRemaining: number;
}
```

- Sliding window: 5-minute average of token deltas
- Cold start: 60 seconds minimum before displaying
- Display: Appended to Line 2 metrics as `│ 1.2k tok/m`

### Session Stats

New module `src/session-stats.ts`:

```typescript
interface SessionStats {
  startTime: Date;
  totalToolCalls: number;
  totalAgentRuns: number;
  peakContextPercent: number;
  autocompactCount: number;
}
```

- **Autocompact detection**: Context% drops >20% sustained across 2+ consecutive invocations (prevents false positives from model switches or transient glitches)
- **Persistence**: Written to cache directory
- **Display integration** (no dedicated line):
  - Tool call total in tools line: `✓ Read ×3 │ total: 47`
  - Autocompact count in context: `92% ctx (2nd compact)`

## 6. Config Extension Summary

All new fields with defaults (backward-compatible):

```typescript
// display section additions
showFrameworks: boolean;      // default: false
showBurnRate: boolean;        // default: false
showAlerts: boolean;          // default: true
activityIndicator: boolean;   // default: true
treePrefixes: boolean;        // default: true
mergeToolsAgents: boolean;    // default: true
barStyle: 'classic' | 'modern';  // default: 'classic' (preserves existing bar chars)

// new top-level sections
frameworks: {
  agw: { enabled: boolean; endpoint: string };    // default: { enabled: true, endpoint: "http://localhost:3000" }
  agentTeams: { enabled: boolean };               // default: { enabled: true }
};

alerts: {
  context: { warningThreshold: number; criticalThreshold: number; actions: AlertAction };
  usage5h: { warningThreshold: number; criticalThreshold: number; actions: AlertAction };
  usage7d: { warningThreshold: number; actions: AlertAction };
};
```

No existing config fields are removed or changed in meaning. Users who don't set new fields get identical behavior to current version.

### HudElement Extension

The existing `HudElement` type must be extended:

```typescript
// Before
type HudElement = 'project' | 'context' | 'usage' | 'environment' | 'tools' | 'agents' | 'todos';

// After
type HudElement = 'project' | 'context' | 'usage' | 'environment' | 'framework' | 'tools' | 'agents' | 'todos' | 'alert';
```

`DEFAULT_ELEMENT_ORDER` updated to include `'framework'` (after `'environment'`) and `'alert'` (after `'todos'`). Existing users with custom `elementOrder` will not see new elements unless they add them.

### RenderContext Extension

```typescript
// New fields added to RenderContext
interface RenderContext {
  // ... existing fields ...
  frameworkStatus: FrameworkStatus[];  // From providers (empty array if none active)
  alerts: Alert[];                     // From alert engine (empty array if none triggered)
  burnRate: BurnRate | null;           // From burn-rate module (null if cold start)
  sessionStats: SessionStats;          // From session-stats module
}
```

## 7. New Files Summary

| File | Purpose |
|------|---------|
| `src/cache.ts` | Unified file cache with TTL |
| `src/alert.ts` | Alert evaluation engine |
| `src/burn-rate.ts` | Token burn rate calculation (sliding window) |
| `src/session-stats.ts` | Session statistics tracking |
| `src/providers/index.ts` | Provider interface + loader |
| `src/providers/agw-provider.ts` | AGW combo status |
| `src/providers/agent-teams-provider.ts` | Agent Teams status |
| `src/render/framework-line.ts` | Framework status rendering |
| `src/render/alert-line.ts` | Alert rendering |

## 8. Modified Files Summary

| File | Changes |
|------|---------|
| `src/index.ts` | Integrate cache, providers, alerts, session stats |
| `src/types.ts` | Add new interfaces (FrameworkProvider, Alert, BurnRate, SessionStats, config types) |
| `src/config.ts` | Extend HudConfig with new fields + defaults |
| `src/transcript.ts` | Incremental parsing with byte offset |
| `src/git.ts` | Use cache layer instead of direct execFile |
| `src/render/index.ts` | Add framework, alert lines + tree prefix logic |
| `src/render/lines/project.ts` | Activity indicator `◉` + merged layout |
| `src/render/lines/identity.ts` | Modern bar chars `▰▱` + barStyle option |
| `src/render/lines/usage.ts` | Modern bar chars + burn rate display |
| `src/render/tools-line.ts` | Merge agents into tools line (configurable) |
| `src/render/todos-line.ts` | Mini progress bar `▪▪▪▪▪` |
| `src/render/colors.ts` | New color constants for framework/alert |

## 9. Testing Plan

Each new module gets its own test file:

| Test File | Coverage |
|-----------|----------|
| `tests/cache.test.ts` | TTL expiry, mtime invalidation, incremental offset, single-file consolidation |
| `tests/alert.test.ts` | Threshold evaluation, prediction calc, bell anti-spam |
| `tests/burn-rate.test.ts` | Sliding window calculation, cold start behavior |
| `tests/session-stats.test.ts` | Autocompact detection (sustained drop), peak tracking |
| `tests/providers.test.ts` | AGW/Agent Teams availability, data parsing, failure cache, error boundary |
| `tests/framework-line.test.ts` | Rendering with various provider states |
| `tests/alert-line.test.ts` | Single/multi alert rendering, tree prefix |

Existing tests updated for:
- New config fields in `config.test.js`
- Tree prefix rendering in `render.test.js`
- Modern bar chars in `render.test.js`
- Merged tools+agents in `render.test.js`
