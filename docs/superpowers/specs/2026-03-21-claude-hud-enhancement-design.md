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

#### Cache Strategy

| Data Source | Cache Key | TTL | Invalidation |
|------------|-----------|-----|--------------|
| Transcript parse | `transcript-{hash}` | 500ms | File mtime change |
| Git status | `git-status` | 2s | Fixed TTL |
| Git ahead/behind | `git-remote` | 10s | Fixed TTL |
| Config | `config` | 5s | Fixed TTL |
| MCP/rules count | `config-counts` | 30s | Fixed TTL |

#### Transcript Incremental Parsing

- Record last-read byte offset in cache
- On next invocation, only read bytes after the offset
- Merge new tool/agent/todo entries into cached `TranscriptData`
- Full re-parse only when file mtime indicates truncation (offset > file size)

#### Expected Performance

- Cold start: ~50ms
- Hot path (all caches valid): <5ms
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

- **Detection**: `GET http://localhost:<port>/health` (500ms timeout)
- **Data**: `GET /combos` for active combo list
- **Cache TTL**: 3s
- **Failure**: Silent skip (no error display)

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

- `modern` (default): `▰` (filled) + `▱` (empty)
- `classic`: `█` (filled) + `░` (empty)
- Configurable via `barStyle: 'classic' | 'modern'`

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

### Todo Mini Progress Bar

```
▸ Fix auth bug (2/5) │ ▪▪▪▪▪
                        ^^--- green=done, orange=in_progress, dim=pending
```

## 5. Feature Expansion

### Burn Rate

Extension of existing `src/speed-tracker.ts`:

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

- **Autocompact detection**: Context% drops >20% between consecutive invocations
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

barStyle: 'classic' | 'modern';  // default: 'modern'
```

No existing config fields are removed or changed in meaning. Users who don't set new fields get identical behavior to current version.

## 7. New Files Summary

| File | Purpose |
|------|---------|
| `src/cache.ts` | Unified file cache with TTL |
| `src/alert.ts` | Alert evaluation engine |
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
| `src/speed-tracker.ts` | Extend with burn rate calculation |
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
| `tests/cache.test.js` | TTL expiry, mtime invalidation, incremental offset |
| `tests/alert.test.js` | Threshold evaluation, prediction calc, bell anti-spam |
| `tests/session-stats.test.js` | Autocompact detection, burn rate sliding window |
| `tests/providers.test.js` | AGW/Agent Teams availability check, data parsing, failure handling |
| `tests/framework-line.test.js` | Rendering with various provider states |
| `tests/alert-line.test.js` | Single/multi alert rendering, tree prefix |

Existing tests updated for:
- New config fields in `config.test.js`
- Tree prefix rendering in `render.test.js`
- Modern bar chars in `render.test.js`
- Merged tools+agents in `render.test.js`
