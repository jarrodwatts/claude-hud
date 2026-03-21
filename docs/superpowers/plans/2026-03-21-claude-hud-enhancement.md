# Claude HUD Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance claude-hud with a cache layer, framework providers (AGW + Agent Teams), alert engine, Dashboard Rich visual style, and burn rate/session stats — all backward-compatible and upstream-friendly.

**Architecture:** Incremental enhancement on existing process-per-invocation model. New modules (cache, providers, alerts, burn-rate, session-stats) are independent and opt-in via config. Existing render pipeline restructured to support Dashboard Rich layout while preserving compact mode.

**Tech Stack:** TypeScript 5, Node.js 18+, zero external dependencies, Node built-in test runner

**Spec:** `docs/superpowers/specs/2026-03-21-claude-hud-enhancement-design.md`

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `src/cache.ts` | Unified file-based cache with TTL, single JSON file |
| `src/burn-rate.ts` | Input token burn rate via sliding window |
| `src/session-stats.ts` | Session statistics (peak context, autocompact count) |
| `src/alert.ts` | Threshold-based alert evaluation with configurable actions |
| `src/providers/index.ts` | FrameworkProvider interface + loader |
| `src/providers/agw-provider.ts` | AGW combo status via HTTP |
| `src/providers/agent-teams-provider.ts` | Agent Teams worktree status |
| `src/render/framework-line.ts` | Framework status line renderer |
| `src/render/alert-line.ts` | Alert line renderer |
| `tests/cache.test.js` | Cache tests |
| `tests/burn-rate.test.js` | Burn rate tests |
| `tests/session-stats.test.js` | Session stats tests |
| `tests/alert.test.js` | Alert tests |
| `tests/providers.test.js` | Provider tests |
| `tests/framework-line.test.js` | Framework line render tests |
| `tests/alert-line.test.js` | Alert line render tests |

### Modified Files
| File | Changes |
|------|---------|
| `src/types.ts` | Add FrameworkStatus, FrameworkEntry, Alert, BurnRate, SessionStats, AlertAction interfaces |
| `src/config.ts` | Extend HudConfig + HudElement with new fields, defaults, validation |
| `src/index.ts` | Integrate cache, providers, alerts, burn-rate, session-stats into main() |
| `src/transcript.ts` | Incremental parsing with byte offset |
| `src/git.ts` | Use cache layer |
| `src/render/index.ts` | Tree prefixes, framework/alert element routing, render pipeline restructure |
| `src/render/colors.ts` | barStyle support (▰▱ vs █░), threshold unification with alert config |
| `src/render/lines/project.ts` | Activity indicator ◉, duration on Line 1 |
| `src/render/lines/identity.ts` | Merged metrics line (context + usage + burn rate) |
| `src/render/lines/usage.ts` | Support being rendered inline with identity line |
| `src/render/tools-line.ts` | Merge agents option, total tool call count |
| `src/render/todos-line.ts` | Mini progress bar ▪▪▪ |

---

## Task 1: Cache Layer

**Files:**
- Create: `src/cache.ts`
- Create: `tests/cache.test.js`

- [ ] **Step 1: Write failing tests for cache read/write**

**Note:** All new test files use `.js` extension and import from `../dist/` to match existing test conventions.

```javascript
// tests/cache.test.js
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { readCache, writeCache } = require('../dist/cache.js');

describe('cache', () => {
  let cacheDir;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-cache-test-'));
  });

  afterEach(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it('returns null for missing cache', () => {
    const result = readCache('test-key', 1000, cacheDir);
    assert.strictEqual(result, null);
  });

  it('writes and reads cache within TTL', () => {
    writeCache('test-key', { foo: 'bar' }, cacheDir);
    const result = readCache('test-key', 5000, cacheDir);
    assert.deepStrictEqual(result, { foo: 'bar' });
  });

  it('returns null for expired cache', () => {
    writeCache('test-key', { foo: 'bar' }, cacheDir);
    const cacheFile = path.join(cacheDir, 'cache.json');
    const data = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    data['test-key'].timestamp = Date.now() - 10000;
    fs.writeFileSync(cacheFile, JSON.stringify(data));
    const result = readCache('test-key', 5000, cacheDir);
    assert.strictEqual(result, null);
  });

  it('stores multiple keys in single file', () => {
    writeCache('key-a', 'value-a', cacheDir);
    writeCache('key-b', 'value-b', cacheDir);
    assert.strictEqual(readCache('key-a', 5000, cacheDir), 'value-a');
    assert.strictEqual(readCache('key-b', 5000, cacheDir), 'value-b');
  });

  it('invalidates by mtime when provided', () => {
    writeCache('mtime-key', 'data', cacheDir, 12345);
    assert.strictEqual(readCache('mtime-key', 5000, cacheDir, 12345), 'data');
    assert.strictEqual(readCache('mtime-key', 5000, cacheDir, 99999), null);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/asd/2026\ DEX\ CLAUDE\ CODE/cchub/claude-hud && npm run build && node --test tests/cache.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement cache module**

```typescript
// src/cache.ts
import fs from 'node:fs';
import path from 'node:path';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  mtime?: number;
}

type CacheStore = Record<string, CacheEntry<unknown>>;

function getCacheFile(cacheDir: string): string {
  return path.join(cacheDir, 'cache.json');
}

function loadStore(cacheDir: string): CacheStore {
  try {
    const file = getCacheFile(cacheDir);
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return {};
  }
}

function saveStore(cacheDir: string, store: CacheStore): void {
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(getCacheFile(cacheDir), JSON.stringify(store));
}

export function readCache<T>(key: string, ttlMs: number, cacheDir: string, mtime?: number): T | null {
  const store = loadStore(cacheDir);
  const entry = store[key] as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() - entry.timestamp > ttlMs) return null;
  if (mtime !== undefined && entry.mtime !== mtime) return null;
  return entry.data;
}

export function writeCache<T>(key: string, data: T, cacheDir: string, mtime?: number): void {
  const store = loadStore(cacheDir);
  store[key] = { data, timestamp: Date.now(), mtime };
  saveStore(cacheDir, store);
}

export function getDefaultCacheDir(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME || '', '.claude');
  return path.join(configDir, 'plugins', 'claude-hud', '.cache');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test tests/cache.test.js`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cache.ts tests/cache.test.js
git commit -m "feat: add unified file-based cache layer with TTL"
```

---

## Task 2: Extend Types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add new interfaces to types.ts**

Add after existing interfaces (after line ~91):

```typescript
// Framework provider types
export interface FrameworkEntry {
  label: string;
  status: 'running' | 'completed' | 'error' | 'waiting';
  progress?: string;
  detail?: string;
}

export interface FrameworkStatus {
  provider: string;
  entries: FrameworkEntry[];
}

export interface FrameworkProvider {
  name: string;
  isAvailable(): boolean;
  fetch(): Promise<FrameworkStatus | null>;
}

// Alert types
export interface AlertAction {
  visual: boolean;
  bell: boolean;
  predict: boolean;
}

export interface Alert {
  type: 'context-warning' | 'context-critical' | 'usage-5h-warning' | 'usage-5h-critical' | 'usage-7d-warning';
  message: string;
  actions: AlertAction;
}

// Burn rate
export interface BurnRate {
  tokensPerMinute: number;
  estimatedCallsRemaining: number;
}

// Session stats
export interface SessionStats {
  startTime?: Date;
  totalToolCalls: number;
  totalAgentRuns: number;
  peakContextPercent: number;
  autocompactCount: number;
}
```

Extend `RenderContext` — add these fields after `extraLabel`:

```typescript
  frameworkStatus: FrameworkStatus[];
  alerts: Alert[];
  burnRate: BurnRate | null;
  sessionStats: SessionStats;
```

- [ ] **Step 2: Verify build passes**

Run: `npm run build`
Expected: No errors (existing code doesn't reference new types yet)

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add framework, alert, burn-rate, session-stats type definitions"
```

---

## Task 3: Extend Config

**Files:**
- Modify: `src/config.ts`
- Modify: `tests/config.test.js` (existing)

- [ ] **Step 1: Write failing test for new config fields**

Add to `tests/config.test.js`:

```javascript
it('merges new enhancement config fields with defaults', () => {
  const config = mergeConfig({
    display: { showFrameworks: true, barStyle: 'modern' },
    alerts: { context: { warningThreshold: 60 } },
    frameworks: { agw: { endpoint: 'http://localhost:4000' } },
  });
  assert.strictEqual(config.display.showFrameworks, true);
  assert.strictEqual(config.display.barStyle, 'modern');
  assert.strictEqual(config.display.showAlerts, true); // default
  assert.strictEqual(config.display.activityIndicator, true); // default
  assert.strictEqual(config.display.treePrefixes, true); // default
  assert.strictEqual(config.display.mergeToolsAgents, true); // default
  assert.strictEqual(config.alerts.context.warningThreshold, 60);
  assert.strictEqual(config.alerts.context.criticalThreshold, 85); // default
  assert.strictEqual(config.alerts.context.actions.visual, true); // default
  assert.strictEqual(config.frameworks.agw.endpoint, 'http://localhost:4000');
  assert.strictEqual(config.frameworks.agw.enabled, true); // default
  assert.strictEqual(config.frameworks.agentTeams.enabled, true); // default
});

it('includes framework and alert in HudElement type', () => {
  const config = mergeConfig({
    elementOrder: ['project', 'context', 'usage', 'framework', 'tools', 'alert', 'todos'],
  });
  assert.ok(config.elementOrder.includes('framework'));
  assert.ok(config.elementOrder.includes('alert'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test tests/config.test.js`
Expected: FAIL — showFrameworks/alerts/frameworks not in type

- [ ] **Step 3: Extend HudConfig, HudElement, and DEFAULT_CONFIG**

In `src/config.ts`:

Extend `HudElement`:
```typescript
export type HudElement = 'project' | 'context' | 'usage' | 'environment' | 'framework' | 'tools' | 'agents' | 'todos' | 'alert';
```

Add to `HudConfig.display`:
```typescript
  showFrameworks: boolean;
  showBurnRate: boolean;
  showAlerts: boolean;
  activityIndicator: boolean;
  treePrefixes: boolean;
  mergeToolsAgents: boolean;
  barStyle: 'classic' | 'modern';
```

Add new top-level sections to `HudConfig`:
```typescript
  frameworks: {
    agw: { enabled: boolean; endpoint: string };
    agentTeams: { enabled: boolean };
  };
  alerts: {
    context: { warningThreshold: number; criticalThreshold: number; actions: AlertAction };
    usage5h: { warningThreshold: number; criticalThreshold: number; actions: AlertAction };
    usage7d: { warningThreshold: number; actions: AlertAction };
  };
```

Extend `DEFAULT_CONFIG` with defaults:
```typescript
  display: {
    // ...existing...
    showFrameworks: false,
    showBurnRate: false,
    showAlerts: true,
    activityIndicator: true,
    treePrefixes: true,
    mergeToolsAgents: true,
    barStyle: 'classic' as const,
  },
  frameworks: {
    agw: { enabled: true, endpoint: 'http://localhost:3000' },
    agentTeams: { enabled: true },
  },
  alerts: {
    context: { warningThreshold: 70, criticalThreshold: 85, actions: { visual: true, bell: false, predict: true } },
    usage5h: { warningThreshold: 70, criticalThreshold: 90, actions: { visual: true, bell: true, predict: true } },
    usage7d: { warningThreshold: 80, actions: { visual: true, bell: false, predict: true } },
  },
```

Update `DEFAULT_ELEMENT_ORDER`:
```typescript
export const DEFAULT_ELEMENT_ORDER: HudElement[] = [
  'project', 'context', 'usage', 'environment', 'framework', 'tools', 'agents', 'todos', 'alert',
];
```

Update `mergeConfig` to deep-merge new sections (follow existing pattern for nested objects like `gitStatus` and `display`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test tests/config.test.js`
Expected: All tests PASS (including new ones)

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.js
git commit -m "feat: extend config with framework, alert, and display options"
```

---

## Task 4: Burn Rate Module

**Files:**
- Create: `src/burn-rate.ts`
- Create: `tests/burn-rate.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
// tests/burn-rate.test.js
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { calculateBurnRate, recordTokenSnapshot } = require('../dist/burn-rate.js');

describe('burn-rate', () => {
  let cacheDir;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-burn-test-'));
  });

  afterEach(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it('returns null on cold start (no history)', () => {
    const result = calculateBurnRate(50000, 200000, cacheDir);
    assert.strictEqual(result, null);
  });

  it('returns null before 60s of data', () => {
    recordTokenSnapshot(40000, cacheDir, Date.now() - 30000);
    const result = calculateBurnRate(50000, 200000, cacheDir);
    assert.strictEqual(result, null);
  });

  it('calculates burn rate after sufficient data', () => {
    const now = Date.now();
    recordTokenSnapshot(40000, cacheDir, now - 120000);
    recordTokenSnapshot(45000, cacheDir, now - 60000);
    recordTokenSnapshot(50000, cacheDir, now);
    const result = calculateBurnRate(50000, 200000, cacheDir);
    assert.ok(result !== null);
    assert.ok(result.tokensPerMinute > 0);
    assert.ok(result.estimatedCallsRemaining > 0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && node --test tests/burn-rate.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement burn-rate module**

```typescript
// src/burn-rate.ts
import { readCache, writeCache } from './cache.js';
import type { BurnRate } from './types.js';

interface TokenSnapshot {
  tokens: number;
  timestamp: number;
}

const CACHE_KEY = 'burn-rate-snapshots';
const WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MIN_DATA_MS = 60 * 1000;   // 60s minimum before showing
const SNAPSHOT_TTL = 10 * 60 * 1000; // 10 min cache TTL (snapshots manage own window)

export function recordTokenSnapshot(tokens: number, cacheDir: string, timestamp?: number): void {
  const now = timestamp ?? Date.now();
  const snapshots = readCache<TokenSnapshot[]>(CACHE_KEY, SNAPSHOT_TTL, cacheDir) ?? [];
  snapshots.push({ tokens, timestamp: now });
  // Keep only snapshots within window
  const cutoff = now - WINDOW_MS;
  const trimmed = snapshots.filter(s => s.timestamp >= cutoff);
  writeCache(CACHE_KEY, trimmed, cacheDir);
}

export function calculateBurnRate(currentTokens: number, contextWindowSize: number, cacheDir: string): BurnRate | null {
  const snapshots = readCache<TokenSnapshot[]>(CACHE_KEY, SNAPSHOT_TTL, cacheDir);
  if (!snapshots || snapshots.length < 2) return null;

  const oldest = snapshots[0];
  const newest = snapshots[snapshots.length - 1];
  const elapsedMs = newest.timestamp - oldest.timestamp;

  if (elapsedMs < MIN_DATA_MS) return null;

  const tokenDelta = newest.tokens - oldest.tokens;
  if (tokenDelta <= 0) return null;

  const tokensPerMinute = Math.round((tokenDelta / elapsedMs) * 60000);
  const remaining = contextWindowSize - currentTokens;
  const avgPerCall = tokenDelta / (snapshots.length - 1);
  const estimatedCallsRemaining = avgPerCall > 0 ? Math.floor(remaining / avgPerCall) : 0;

  return { tokensPerMinute, estimatedCallsRemaining };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test tests/burn-rate.test.js`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/burn-rate.ts tests/burn-rate.test.js
git commit -m "feat: add burn rate calculator with sliding window"
```

---

## Task 5: Session Stats Module

**Files:**
- Create: `src/session-stats.ts`
- Create: `tests/session-stats.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
// tests/session-stats.test.js
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { getSessionStats, updateSessionStats } = require('../dist/session-stats.js');

describe('session-stats', () => {
  let cacheDir;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-stats-test-'));
  });

  afterEach(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it('initializes with zero stats', () => {
    const stats = getSessionStats(cacheDir);
    assert.strictEqual(stats.totalToolCalls, 0);
    assert.strictEqual(stats.autocompactCount, 0);
    assert.strictEqual(stats.peakContextPercent, 0);
  });

  it('tracks peak context percent', () => {
    updateSessionStats(cacheDir, { contextPercent: 45, toolCount: 5, agentCount: 1 });
    updateSessionStats(cacheDir, { contextPercent: 72, toolCount: 8, agentCount: 1 });
    updateSessionStats(cacheDir, { contextPercent: 60, toolCount: 10, agentCount: 2 });
    const stats = getSessionStats(cacheDir);
    assert.strictEqual(stats.peakContextPercent, 72);
    assert.strictEqual(stats.totalToolCalls, 10);
    assert.strictEqual(stats.totalAgentRuns, 2);
  });

  it('detects autocompact after sustained drop', () => {
    updateSessionStats(cacheDir, { contextPercent: 85, toolCount: 10, agentCount: 0 });
    updateSessionStats(cacheDir, { contextPercent: 40, toolCount: 10, agentCount: 0 });
    updateSessionStats(cacheDir, { contextPercent: 42, toolCount: 11, agentCount: 0 });
    const stats = getSessionStats(cacheDir);
    assert.strictEqual(stats.autocompactCount, 1);
  });

  it('does not false-positive on small drops', () => {
    updateSessionStats(cacheDir, { contextPercent: 50, toolCount: 5, agentCount: 0 });
    updateSessionStats(cacheDir, { contextPercent: 45, toolCount: 6, agentCount: 0 });
    updateSessionStats(cacheDir, { contextPercent: 43, toolCount: 7, agentCount: 0 });
    const stats = getSessionStats(cacheDir);
    assert.strictEqual(stats.autocompactCount, 0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && node --test tests/session-stats.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement session-stats module**

```typescript
// src/session-stats.ts
import { readCache, writeCache } from './cache.js';
import type { SessionStats } from './types.js';

const CACHE_KEY = 'session-stats';
const HISTORY_KEY = 'context-history';
const TTL = 24 * 60 * 60 * 1000; // 24h (session-scoped, effectively no expiry)
const DROP_THRESHOLD = 20; // percent

interface ContextHistory {
  values: number[];  // last 3 context percentages
}

interface UpdateInput {
  contextPercent: number;
  toolCount: number;
  agentCount: number;
}

export function getSessionStats(cacheDir: string): SessionStats {
  const cached = readCache<SessionStats>(CACHE_KEY, TTL, cacheDir);
  return cached ?? {
    totalToolCalls: 0,
    totalAgentRuns: 0,
    peakContextPercent: 0,
    autocompactCount: 0,
  };
}

export function updateSessionStats(cacheDir: string, input: UpdateInput): void {
  const stats = getSessionStats(cacheDir);
  const history = readCache<ContextHistory>(HISTORY_KEY, TTL, cacheDir) ?? { values: [] };

  // Update stats
  stats.totalToolCalls = input.toolCount;
  stats.totalAgentRuns = input.agentCount;
  if (input.contextPercent > stats.peakContextPercent) {
    stats.peakContextPercent = input.contextPercent;
  }

  // Autocompact detection: sustained >20% drop across 2+ readings
  history.values.push(input.contextPercent);
  if (history.values.length > 3) history.values.shift();

  if (history.values.length >= 3) {
    const [prev2, prev1, current] = history.values.slice(-3);
    const dropFromPrev2 = prev2 - prev1;
    const sustainedDrop = prev2 - current;
    if (dropFromPrev2 > DROP_THRESHOLD && sustainedDrop > DROP_THRESHOLD) {
      stats.autocompactCount++;
      // Reset history after detection to avoid double-counting
      history.values = [current];
    }
  }

  writeCache(CACHE_KEY, stats, cacheDir);
  writeCache(HISTORY_KEY, history, cacheDir);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test tests/session-stats.test.js`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/session-stats.ts tests/session-stats.test.js
git commit -m "feat: add session stats with autocompact detection"
```

---

## Task 6: Alert Engine

**Files:**
- Create: `src/alert.ts`
- Create: `tests/alert.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
// tests/alert.test.js
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { evaluateAlerts, shouldBell } = require('../dist/alert.js');

describe('alert engine', () => {
  let cacheDir;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-alert-test-'));
  });

  afterEach(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  const defaultAlertConfig = {
    context: { warningThreshold: 70, criticalThreshold: 85, actions: { visual: true, bell: false, predict: true } },
    usage5h: { warningThreshold: 70, criticalThreshold: 90, actions: { visual: true, bell: true, predict: true } },
    usage7d: { warningThreshold: 80, actions: { visual: true, bell: false, predict: true } },
  };

  it('returns empty array when all values below thresholds', () => {
    const alerts = evaluateAlerts({
      contextPercent: 50,
      usage5hPercent: 30,
      usage7dPercent: 40,
      estimatedCallsRemaining: null,
      usageResetTime: null,
      alertConfig: defaultAlertConfig,
      cacheDir,
    });
    assert.strictEqual(alerts.length, 0);
  });

  it('returns context-warning when context >= 70%', () => {
    const alerts = evaluateAlerts({
      contextPercent: 72,
      usage5hPercent: 30,
      usage7dPercent: 40,
      estimatedCallsRemaining: 25,
      usageResetTime: null,
      alertConfig: defaultAlertConfig,
      cacheDir,
    });
    assert.strictEqual(alerts.length, 1);
    assert.strictEqual(alerts[0].type, 'context-warning');
    assert.ok(alerts[0].message.includes('25'));
  });

  it('returns context-critical over context-warning when >= 85%', () => {
    const alerts = evaluateAlerts({
      contextPercent: 92,
      usage5hPercent: 30,
      usage7dPercent: 40,
      estimatedCallsRemaining: 8,
      usageResetTime: null,
      alertConfig: defaultAlertConfig,
      cacheDir,
    });
    assert.strictEqual(alerts.length, 1);
    assert.strictEqual(alerts[0].type, 'context-critical');
  });

  it('returns multiple alerts when both context and usage exceed thresholds', () => {
    const alerts = evaluateAlerts({
      contextPercent: 90,
      usage5hPercent: 92,
      usage7dPercent: 40,
      estimatedCallsRemaining: 8,
      usageResetTime: '14:32',
      alertConfig: defaultAlertConfig,
      cacheDir,
    });
    assert.strictEqual(alerts.length, 2);
    const types = alerts.map(a => a.type);
    assert.ok(types.includes('context-critical'));
    assert.ok(types.includes('usage-5h-critical'));
  });

  it('bell fires only once per level transition', () => {
    const input = {
      contextPercent: 90,
      usage5hPercent: 30,
      usage7dPercent: 40,
      estimatedCallsRemaining: 8,
      usageResetTime: null,
      alertConfig: defaultAlertConfig,
      cacheDir,
    };
    const alerts1 = evaluateAlerts(input);
    const alerts2 = evaluateAlerts(input);
    assert.strictEqual(shouldBell(alerts1, cacheDir), false); // context bell defaults to false
    input.usage5hPercent = 95;
    const alerts3 = evaluateAlerts(input);
    assert.strictEqual(shouldBell(alerts3, cacheDir), true); // first trigger
    const alerts4 = evaluateAlerts(input);
    assert.strictEqual(shouldBell(alerts4, cacheDir), false); // already fired
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && node --test tests/alert.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement alert engine**

```typescript
// src/alert.ts
import { readCache, writeCache } from './cache.js';
import type { Alert, AlertAction } from './types.js';

interface AlertConfig {
  context: { warningThreshold: number; criticalThreshold: number; actions: AlertAction };
  usage5h: { warningThreshold: number; criticalThreshold: number; actions: AlertAction };
  usage7d: { warningThreshold: number; actions: AlertAction };
}

interface EvaluateInput {
  contextPercent: number;
  usage5hPercent: number;
  usage7dPercent: number;
  estimatedCallsRemaining: number | null;
  usageResetTime: string | null;
  alertConfig: AlertConfig;
  cacheDir: string;
}

const BELL_STATE_KEY = 'alert-bell-state';

export function evaluateAlerts(input: EvaluateInput): Alert[] {
  const { contextPercent, usage5hPercent, usage7dPercent, estimatedCallsRemaining, usageResetTime, alertConfig } = input;
  const alerts: Alert[] = [];

  // Context alerts (critical overrides warning)
  if (contextPercent >= alertConfig.context.criticalThreshold) {
    const callsHint = estimatedCallsRemaining != null ? ` — ~${estimatedCallsRemaining} calls` : '';
    alerts.push({
      type: 'context-critical',
      message: `Context ${contextPercent}%${callsHint}`,
      actions: alertConfig.context.actions,
    });
  } else if (contextPercent >= alertConfig.context.warningThreshold) {
    const callsHint = estimatedCallsRemaining != null ? ` — ~${estimatedCallsRemaining} calls to autocompact` : '';
    alerts.push({
      type: 'context-warning',
      message: `Context ${contextPercent}%${callsHint}`,
      actions: alertConfig.context.actions,
    });
  }

  // Usage 5h alerts
  if (usage5hPercent >= alertConfig.usage5h.criticalThreshold) {
    const resetHint = usageResetTime ? ` — resets ${usageResetTime}` : '';
    alerts.push({
      type: 'usage-5h-critical',
      message: `Usage ${usage5hPercent}%${resetHint}`,
      actions: alertConfig.usage5h.actions,
    });
  } else if (usage5hPercent >= alertConfig.usage5h.warningThreshold) {
    const resetHint = usageResetTime ? ` — resets ${usageResetTime}` : '';
    alerts.push({
      type: 'usage-5h-warning',
      message: `Usage ${usage5hPercent}%${resetHint}`,
      actions: alertConfig.usage5h.actions,
    });
  }

  // Usage 7d alerts
  if (usage7dPercent >= alertConfig.usage7d.warningThreshold) {
    alerts.push({
      type: 'usage-7d-warning',
      message: `7d Usage ${usage7dPercent}%`,
      actions: alertConfig.usage7d.actions,
    });
  }

  return alerts;
}

export function shouldBell(alerts: Alert[], cacheDir: string): boolean {
  const bellAlerts = alerts.filter(a => a.actions.bell);
  if (bellAlerts.length === 0) return false;

  const prevState = readCache<string[]>(BELL_STATE_KEY, 24 * 60 * 60 * 1000, cacheDir) ?? [];
  const currentTypes = bellAlerts.map(a => a.type);
  const newTypes = currentTypes.filter(t => !prevState.includes(t));

  if (newTypes.length > 0) {
    writeCache(BELL_STATE_KEY, currentTypes, cacheDir);
    return true;
  }
  return false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test tests/alert.test.js`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/alert.ts tests/alert.test.js
git commit -m "feat: add alert engine with threshold evaluation and bell anti-spam"
```

---

## Task 7: Framework Providers

**Files:**
- Create: `src/providers/index.ts`
- Create: `src/providers/agw-provider.ts`
- Create: `src/providers/agent-teams-provider.ts`
- Create: `tests/providers.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
// tests/providers.test.js
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

describe('providers', () => {
  describe('agw-provider', () => {
    it('fetch returns null on connection error', async () => {
      const { AgwProvider } = await import('../dist/providers/agw-provider.js');
      const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-agw-'));
      const provider = new AgwProvider('http://localhost:59999', cacheDir);
      const result = await provider.fetch();
      assert.strictEqual(result, null);
      fs.rmSync(cacheDir, { recursive: true, force: true });
    });
  });

  describe('agent-teams-provider', () => {
    it('isAvailable returns false without env var', async () => {
      const origVal = process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS;
      delete process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS;
      const { AgentTeamsProvider } = await import('../dist/providers/agent-teams-provider.js');
      const provider = new AgentTeamsProvider(os.tmpdir());
      assert.strictEqual(provider.isAvailable(), false);
      if (origVal !== undefined) process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = origVal;
    });

    it('isAvailable returns true with env var set', async () => {
      const origVal = process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS;
      process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1';
      const { AgentTeamsProvider } = await import('../dist/providers/agent-teams-provider.js');
      const provider = new AgentTeamsProvider(os.tmpdir());
      assert.strictEqual(provider.isAvailable(), true);
      if (origVal !== undefined) {
        process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = origVal;
      } else {
        delete process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS;
      }
    });
  });

  describe('provider loader', () => {
    it('loadProviders returns array of providers', async () => {
      const { loadProviders } = await import('../dist/providers/index.js');
      const providers = loadProviders({
        agw: { enabled: true, endpoint: 'http://localhost:3000' },
        agentTeams: { enabled: true },
      }, os.tmpdir());
      assert.ok(Array.isArray(providers));
      assert.strictEqual(providers.length, 2);
    });

    it('respects enabled flags', async () => {
      const { loadProviders } = await import('../dist/providers/index.js');
      const providers = loadProviders({
        agw: { enabled: false, endpoint: 'http://localhost:3000' },
        agentTeams: { enabled: false },
      }, os.tmpdir());
      assert.strictEqual(providers.length, 0);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && node --test tests/providers.test.js`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement provider index**

```typescript
// src/providers/index.ts
import type { FrameworkProvider, FrameworkStatus } from '../types.js';
import { AgwProvider } from './agw-provider.js';
import { AgentTeamsProvider } from './agent-teams-provider.js';

interface FrameworksConfig {
  agw: { enabled: boolean; endpoint: string };
  agentTeams: { enabled: boolean };
}

export function loadProviders(config: FrameworksConfig, cacheDir: string): FrameworkProvider[] {
  const providers: FrameworkProvider[] = [];
  if (config.agw.enabled) {
    providers.push(new AgwProvider(config.agw.endpoint, cacheDir));
  }
  if (config.agentTeams.enabled) {
    providers.push(new AgentTeamsProvider(cacheDir));
  }
  return providers;
}

export async function fetchAllProviders(providers: FrameworkProvider[]): Promise<FrameworkStatus[]> {
  const results: FrameworkStatus[] = [];
  for (const provider of providers) {
    if (!provider.isAvailable()) continue;
    try {
      const status = await provider.fetch();
      if (status && status.entries.length > 0) {
        results.push(status);
      }
    } catch {
      // Silent skip — error boundary
    }
  }
  return results;
}
```

- [ ] **Step 4: Implement AGW provider**

```typescript
// src/providers/agw-provider.ts
import type { FrameworkProvider, FrameworkStatus, FrameworkEntry } from '../types.js';
import { readCache, writeCache } from '../cache.js';

const CACHE_KEY = 'agw-status';
const SUCCESS_TTL = 3000;
const FAILURE_TTL = 10000;

export class AgwProvider implements FrameworkProvider {
  name = 'agw';
  constructor(private endpoint: string, private cacheDir: string) {}

  isAvailable(): boolean {
    return true; // Availability determined by fetch success
  }

  async fetch(): Promise<FrameworkStatus | null> {
    // Check failure cache first (uses truthy sentinel to distinguish from cache miss)
    const failCached = readCache<boolean>('agw-failure', FAILURE_TTL, this.cacheDir);
    if (failCached === true) return null; // In failure cooldown

    // Check success cache
    const cached = readCache<FrameworkStatus>(CACHE_KEY, SUCCESS_TTL, this.cacheDir);
    if (cached) return cached;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 200);
      const res = await fetch(`${this.endpoint}/combos`, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) {
        writeCache('agw-failure', true, this.cacheDir);
        return null;
      }

      const combos = await res.json() as Array<{ id: string; status: string; progress?: string }>;
      const entries: FrameworkEntry[] = combos.map(c => ({
        label: c.id,
        status: c.status === 'running' ? 'running' : c.status === 'error' ? 'error' : 'completed',
        progress: c.progress,
      }));

      const status: FrameworkStatus = { provider: 'AGW', entries };
      writeCache(CACHE_KEY, status, this.cacheDir);
      return status;
    } catch {
      writeCache('agw-failure', null, this.cacheDir);
      return null;
    }
  }
}
```

- [ ] **Step 5: Implement Agent Teams provider**

```typescript
// src/providers/agent-teams-provider.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FrameworkProvider, FrameworkStatus, FrameworkEntry } from '../types.js';
import { readCache, writeCache } from '../cache.js';

const execFileAsync = promisify(execFile);
const CACHE_KEY = 'agent-teams-status';
const SUCCESS_TTL = 5000;

export class AgentTeamsProvider implements FrameworkProvider {
  name = 'agent-teams';
  constructor(private cacheDir: string) {}

  isAvailable(): boolean {
    return !!process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS;
  }

  async fetch(): Promise<FrameworkStatus | null> {
    const cached = readCache<FrameworkStatus>(CACHE_KEY, SUCCESS_TTL, this.cacheDir);
    if (cached) return cached;

    try {
      const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { timeout: 1000 });
      const worktrees = this.parseWorktrees(stdout);
      if (worktrees.length <= 1) return null; // Only main worktree

      const entries: FrameworkEntry[] = worktrees.slice(1).map(wt => ({
        label: wt.branch?.replace('refs/heads/', '') || 'detached',
        status: 'running' as const,
        detail: wt.path,
      }));

      const status: FrameworkStatus = { provider: 'Teams', entries };
      writeCache(CACHE_KEY, status, this.cacheDir);
      return status;
    } catch {
      return null;
    }
  }

  private parseWorktrees(output: string): Array<{ path: string; branch?: string }> {
    const worktrees: Array<{ path: string; branch?: string }> = [];
    let current: { path: string; branch?: string } | null = null;

    for (const line of output.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current) worktrees.push(current);
        current = { path: line.slice(9) };
      } else if (line.startsWith('branch ') && current) {
        current.branch = line.slice(7);
      }
    }
    if (current) worktrees.push(current);
    return worktrees;
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run build && node --test tests/providers.test.js`
Expected: All 4 tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/providers/ tests/providers.test.js
git commit -m "feat: add AGW and Agent Teams framework providers"
```

---

## Task 8: Framework Line Renderer

**Files:**
- Create: `src/render/framework-line.ts`
- Create: `tests/framework-line.test.js`

**Prerequisite note:** This task depends on `colorize` being exported from `src/render/colors.ts`. Add `export` to the existing `function colorize(...)` in `colors.ts` before implementing this task (will be formalized in Task 10).

- [ ] **Step 1: Export `colorize` from colors.ts**

In `src/render/colors.ts`, change `function colorize(` to `export function colorize(`.

- [ ] **Step 2: Write failing tests**

```javascript
// tests/framework-line.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('framework-line', () => {
  it('returns null when no framework status', async () => {
    const { renderFrameworkLine } = await import('../dist/render/framework-line.js');
    const result = renderFrameworkLine([]);
    assert.strictEqual(result, null);
  });

  it('renders AGW combo status', async () => {
    const { renderFrameworkLine } = await import('../dist/render/framework-line.js');
    const result = renderFrameworkLine([{
      provider: 'AGW',
      entries: [{ label: 'review-loop', status: 'running', progress: '3/5' }],
    }]);
    assert.ok(result !== null);
    // Strip ANSI codes for content check
    const stripped = result.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(stripped.includes('AGW'));
    assert.ok(stripped.includes('review-loop'));
    assert.ok(stripped.includes('3/5'));
  });

  it('renders combined AGW + Teams status', async () => {
    const { renderFrameworkLine } = await import('../dist/render/framework-line.js');
    const result = renderFrameworkLine([
      { provider: 'AGW', entries: [{ label: 'pipeline', status: 'running', progress: '2/4' }] },
      { provider: 'Teams', entries: [
        { label: 'fe', status: 'completed' },
        { label: 'be', status: 'running' },
      ]},
    ]);
    assert.ok(result !== null);
    const stripped = result.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(stripped.includes('AGW'));
    assert.ok(stripped.includes('Teams'));
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run build && node --test tests/framework-line.test.js`
Expected: FAIL — module not found

- [ ] **Step 4: Implement framework-line renderer**

```typescript
// src/render/framework-line.ts
import type { FrameworkStatus } from '../types.js';
import { colorize, claudeOrange, green, dim, RESET } from './colors.js';

const STATUS_ICONS: Record<string, string> = {
  running: claudeOrange('⟳'),
  completed: green('✓'),
  error: colorize('✘', '\x1b[31m'),
  waiting: dim('⏳'),
};

export function renderFrameworkLine(statuses: FrameworkStatus[]): string | null {
  if (statuses.length === 0) return null;

  const parts: string[] = [];

  for (const status of statuses) {
    if (status.provider === 'AGW') {
      for (const entry of status.entries) {
        const icon = STATUS_ICONS[entry.status] || dim('?');
        const progress = entry.progress ? dim(` (${entry.progress})`) : '';
        parts.push(`${icon} AGW: ${entry.label}${progress}`);
      }
    } else if (status.provider === 'Teams') {
      const agentParts = status.entries.map(e => {
        const icon = e.status === 'completed' ? green('✓') :
                     e.status === 'running' ? claudeOrange('◐') :
                     e.status === 'error' ? colorize('✘', '\x1b[31m') : dim('⏳');
        return `${e.label}${icon}`;
      }).join(' ');
      parts.push(`${green('⬡')} Teams: ${agentParts}`);
    }
  }

  return parts.length > 0 ? parts.join(` ${dim('│')} `) : null;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run build && node --test tests/framework-line.test.js`
Expected: All 3 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/render/colors.ts src/render/framework-line.ts tests/framework-line.test.js
git commit -m "feat: add framework line renderer for AGW and Agent Teams"
```

---

## Task 9: Alert Line Renderer

**Files:**
- Create: `src/render/alert-line.ts`
- Create: `tests/alert-line.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
// tests/alert-line.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('alert-line', () => {
  it('returns null with no alerts', async () => {
    const { renderAlertLine } = await import('../dist/render/alert-line.js');
    assert.strictEqual(renderAlertLine([]), null);
  });

  it('renders single alert', async () => {
    const { renderAlertLine } = await import('../dist/render/alert-line.js');
    const result = renderAlertLine([{
      type: 'context-critical',
      message: 'Context 92% — ~8 calls',
      actions: { visual: true, bell: false, predict: true },
    }]);
    assert.ok(result !== null);
    assert.ok(result.includes('92%'));
    assert.ok(result.includes('⚠'));
  });

  it('renders multiple alerts joined by separator', async () => {
    const { renderAlertLine } = await import('../dist/render/alert-line.js');
    const result = renderAlertLine([
      { type: 'context-critical', message: 'Context 92%', actions: { visual: true, bell: false, predict: true } },
      { type: 'usage-5h-critical', message: 'Usage 89%', actions: { visual: true, bell: true, predict: true } },
    ]);
    assert.ok(result !== null);
    assert.ok(result.includes('Context'));
    assert.ok(result.includes('Usage'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && node --test tests/alert-line.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement alert-line renderer**

```typescript
// src/render/alert-line.ts
import type { Alert } from '../types.js';
import { red, dim } from './colors.js';

export function renderAlertLine(alerts: Alert[]): string | null {
  if (alerts.length === 0) return null;

  const parts = alerts.map(alert => {
    const icon = alert.type.includes('critical') ? '⚠' : '⚡';
    return red(`${icon} ${alert.message}`);
  });

  return parts.join(` ${dim('│')} `);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test tests/alert-line.test.js`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/render/alert-line.ts tests/alert-line.test.js
git commit -m "feat: add alert line renderer"
```

---

## Task 10: Visual Changes — Colors and Bar Style

**Files:**
- Modify: `src/render/colors.ts`
- Modify: `tests/render.test.js` (existing)

- [ ] **Step 1: Write failing tests for barStyle**

Add to existing `tests/render.test.js`:

```javascript
describe('barStyle', () => {
  it('coloredBar uses classic chars by default', () => {
    const result = coloredBar(50, 10);
    assert.ok(result.includes('█'));
    assert.ok(result.includes('░'));
  });

  it('coloredBar uses modern chars when barStyle is modern', () => {
    const result = coloredBar(50, 10, undefined, 'modern');
    assert.ok(result.includes('▰'));
    assert.ok(result.includes('▱'));
  });

  it('quotaBar respects barStyle', () => {
    const result = quotaBar(50, 10, undefined, 'modern');
    assert.ok(result.includes('▰'));
    assert.ok(result.includes('▱'));
  });
});

describe('getContextColor with custom thresholds', () => {
  it('uses custom warning threshold', () => {
    const color = getContextColor(65, undefined, { warningThreshold: 60, criticalThreshold: 80 });
    // Should be warning color at 65% with threshold 60
    assert.ok(color.includes('\x1b[')); // Has color code
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && node --test tests/render.test.js`
Expected: FAIL — barStyle param doesn't exist

- [ ] **Step 3: Add barStyle parameter to coloredBar and quotaBar**

In `src/render/colors.ts`:

Add bar character constants:
```typescript
const BAR_CHARS = {
  classic: { filled: '█', empty: '░' },
  modern: { filled: '▰', empty: '▱' },
} as const;
```

Modify `coloredBar` signature:
```typescript
export function coloredBar(
  percent: number,
  width = 10,
  colors?: HudColorOverrides,
  barStyle: 'classic' | 'modern' = 'classic',
  thresholds?: { warningThreshold: number; criticalThreshold: number },
): string
```

Use `BAR_CHARS[barStyle]` for filled/empty characters.

Modify `getContextColor` to accept optional thresholds:
```typescript
export function getContextColor(
  percent: number,
  colors?: HudColorOverrides,
  thresholds?: { warningThreshold: number; criticalThreshold: number },
): string
```

Use `thresholds?.criticalThreshold ?? 85` and `thresholds?.warningThreshold ?? 70`.

Apply same changes to `quotaBar` and `getQuotaColor`.

**Note:** All new parameters are optional with defaults matching current behavior (70/85% for context, 75/90% for usage). Existing callers using the old 2-3 parameter signatures will continue to work unchanged. Callers will be updated to pass thresholds from config in Task 11.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test tests/render.test.js`
Expected: All tests PASS (existing + new)

- [ ] **Step 5: Commit**

```bash
git add src/render/colors.ts tests/render.test.js
git commit -m "feat: add barStyle option (classic/modern) and configurable thresholds"
```

---

## Task 11: Visual Changes — Dashboard Rich Render Pipeline

**Files:**
- Modify: `src/render/lines/project.ts`
- Modify: `src/render/lines/identity.ts`
- Modify: `src/render/tools-line.ts`
- Modify: `src/render/todos-line.ts`
- Modify: `src/render/index.ts`

- [ ] **Step 1: Add activity indicator to project line**

In `src/render/lines/project.ts`, add to the beginning of `renderProjectLine`:

```typescript
// Activity indicator: red if tools running, green if idle
if (ctx.config.display.activityIndicator) {
  const hasRunning = ctx.transcript.tools.some(t => t.status === 'running');
  const indicator = hasRunning ? colorize('◉', '\x1b[31m') : green('◉');
  parts.unshift(indicator);
}
```

- [ ] **Step 2: Add merged tools+agents option to tools-line**

In `src/render/tools-line.ts`, modify `renderToolsLine` to accept agents when `mergeToolsAgents` is true:

After existing tool rendering, add:
```typescript
if (ctx.config.display.mergeToolsAgents && ctx.transcript.agents.length > 0) {
  // Append agent entries after tools
  const recentAgents = ctx.transcript.agents.slice(-2);
  for (const agent of recentAgents) {
    const icon = agent.status === 'running' ? magenta('◐') : green('✓');
    const model = agent.model ? dim(`[${agent.model}]`) : '';
    const desc = agent.description ? dim(`: ${agent.description.slice(0, 30)}`) : '';
    const elapsed = agent.startTime ? dim(`(${formatElapsed(agent.startTime)})`) : '';
    lineParts.push(`${icon} ${agent.type || 'agent'}${model}${desc} ${elapsed}`);
  }
}
```

- [ ] **Step 3: Add mini progress bar to todos-line**

In `src/render/todos-line.ts`, after the progress counter `(${completed}/${total})`, add:

```typescript
// Mini progress bar: ▪ per todo, colored by status
const miniBar = ctx.transcript.todos.slice(0, 10).map(todo => {
  if (todo.status === 'completed') return green('▪');
  if (todo.status === 'in_progress') return claudeOrange('▪');
  return dim('▪');
}).join('');
const suffix = ctx.transcript.todos.length > 10 ? dim('…') : '';
// Append: │ ▪▪▪▪▪
result += ` ${dim('│')} ${miniBar}${suffix}`;
```

- [ ] **Step 4: Add tree prefixes and new element routing to render/index.ts**

In `src/render/index.ts`, add imports at top:
```typescript
import { renderFrameworkLine } from './framework-line.js';
import { renderAlertLine } from './alert-line.js';
```

Then modify `renderExpanded`:

Add tree prefix logic:
```typescript
function addTreePrefixes(lines: string[], useTree: boolean): string[] {
  if (!useTree || lines.length === 0) return lines;
  return lines.map((line, i) => {
    const prefix = i === lines.length - 1 ? dim('└─ ') : dim('├─ ');
    return prefix + line;
  });
}
```

Add element routing for `'framework'` and `'alert'`:
```typescript
case 'framework':
  if (ctx.config.display.showFrameworks && ctx.frameworkStatus.length > 0) {
    const line = renderFrameworkLine(ctx.frameworkStatus);
    if (line) activityLines.push(line);
  }
  break;
case 'alert':
  if (ctx.config.display.showAlerts && ctx.alerts.length > 0) {
    const line = renderAlertLine(ctx.alerts);
    if (line) activityLines.push(line);
  }
  break;
```

Apply tree prefixes to activity lines (lines 3+):
```typescript
const prefixedActivity = addTreePrefixes(activityLines, ctx.config.display.treePrefixes);
```

- [ ] **Step 5: Run all tests**

Run: `npm run build && npm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/render/lines/project.ts src/render/lines/identity.ts src/render/tools-line.ts src/render/todos-line.ts src/render/index.ts
git commit -m "feat: Dashboard Rich visual — activity indicator, tree prefixes, merged tools, mini progress"
```

---

## Task 12: Integration — Wire Everything in main()

**Files:**
- Modify: `src/index.ts`
- Modify: `src/transcript.ts` (incremental parsing)
- Modify: `src/git.ts` (cache integration)

- [ ] **Step 1: Add cache to git.ts**

Wrap existing git calls with cache reads/writes:

```typescript
import { readCache, writeCache, getDefaultCacheDir } from './cache.js';

export async function getGitStatus(cwd?: string): Promise<GitStatus | null> {
  const cacheDir = getDefaultCacheDir();

  // Check cache first (2s TTL for status, 10s for remote)
  const cached = readCache<GitStatus>('git-status', 2000, cacheDir);
  if (cached) return cached;

  // ... existing git logic ...

  if (result) writeCache('git-status', result, cacheDir);
  return result;
}
```

- [ ] **Step 2: Add incremental parsing to transcript.ts**

Add byte offset tracking:

```typescript
import { readCache, writeCache, getDefaultCacheDir } from './cache.js';
import fs from 'node:fs';

export async function parseTranscript(transcriptPath: string): Promise<TranscriptData> {
  const cacheDir = getDefaultCacheDir();
  const stats = fs.statSync(transcriptPath, { throwIfNoEntry: false });
  if (!stats) return emptyTranscriptData();

  const mtime = stats.mtimeMs;
  const cached = readCache<{ data: TranscriptData; offset: number }>('transcript', 500, cacheDir, mtime);

  if (cached && cached.offset <= stats.size) {
    // Incremental: read only new bytes
    const newContent = readBytesFrom(transcriptPath, cached.offset);
    if (newContent.length === 0) return cached.data;

    const merged = mergeTranscriptData(cached.data, parseLines(newContent));
    writeCache('transcript', { data: merged, offset: stats.size }, cacheDir, mtime);
    return merged;
  }

  // Full parse
  const data = await fullParse(transcriptPath);
  writeCache('transcript', { data, offset: stats.size }, cacheDir, mtime);
  return data;
}
```

- [ ] **Step 3: Wire new modules in index.ts main()**

Add imports and integrate into the main orchestration:

```typescript
import { getDefaultCacheDir } from './cache.js';
import { loadProviders, fetchAllProviders } from './providers/index.js';
import { evaluateAlerts, shouldBell } from './alert.js';
import { calculateBurnRate, recordTokenSnapshot } from './burn-rate.js';
import { updateSessionStats, getSessionStats } from './session-stats.js';
```

In `main()`, after existing data gathering:

```typescript
const cacheDir = getDefaultCacheDir();

// Framework providers
let frameworkStatus: FrameworkStatus[] = [];
if (config.display.showFrameworks) {
  const providers = loadProviders(config.frameworks, cacheDir);
  frameworkStatus = await fetchAllProviders(providers);
}

// Burn rate
let burnRate: BurnRate | null = null;
const inputTokens = stdinData.context_window?.current_usage?.input_tokens;
const contextSize = stdinData.context_window?.context_window_size;
if (config.display.showBurnRate && inputTokens && contextSize) {
  recordTokenSnapshot(inputTokens, cacheDir);
  burnRate = calculateBurnRate(inputTokens, contextSize, cacheDir);
}

// Session stats
const contextPercent = /* calculate from stdinData */;
updateSessionStats(cacheDir, {
  contextPercent,
  toolCount: transcript.tools.length,
  agentCount: transcript.agents.length,
});
const sessionStats = getSessionStats(cacheDir);

// Alerts
let alerts: Alert[] = [];
if (config.display.showAlerts) {
  alerts = evaluateAlerts({
    contextPercent,
    usage5hPercent: usageData?.fiveHour ?? 0,
    usage7dPercent: usageData?.sevenDay ?? 0,
    estimatedCallsRemaining: burnRate?.estimatedCallsRemaining ?? null,
    usageResetTime: /* format from usageData */,
    alertConfig: config.alerts,
    cacheDir,
  });

  if (shouldBell(alerts, cacheDir)) {
    process.stderr.write('\x07'); // Terminal bell
  }
}

// Extend RenderContext
const ctx: RenderContext = {
  // ...existing fields...
  frameworkStatus,
  alerts,
  burnRate,
  sessionStats,
};
```

- [ ] **Step 4: Run all tests**

Run: `npm run build && npm test`
Expected: All tests PASS

- [ ] **Step 5: Manual integration test**

Run: `echo '{"model":{"display_name":"Opus"},"context_window":{"current_usage":{"input_tokens":170000},"context_window_size":200000}}' | node dist/index.js 2>&1`
Expected: HUD output with new visual elements (activity indicator, etc.)

- [ ] **Step 6: Commit**

```bash
git add src/index.ts src/transcript.ts src/git.ts
git commit -m "feat: integrate cache, providers, alerts, burn-rate, session-stats into main pipeline"
```

---

## Task 13: Update Existing Tests

**Files:**
- Modify: `tests/core.test.js`
- Modify: `tests/render.test.js`
- Modify: `tests/index.test.js`

- [ ] **Step 1: Update RenderContext mocks in existing tests**

All existing tests that create `RenderContext` objects need the new fields. Add these to every mock context:

```javascript
// New RenderContext fields:
frameworkStatus: [],
alerts: [],
burnRate: null,
sessionStats: { totalToolCalls: 0, totalAgentRuns: 0, peakContextPercent: 0, autocompactCount: 0 },
```

- [ ] **Step 2: Update config mocks with new defaults**

Tests that create `HudConfig` objects need all new fields. The safest approach is to use `mergeConfig({})` to get defaults automatically. For tests that build config manually, add:

```javascript
// New display fields:
display: {
  // ...existing...
  showFrameworks: false,
  showBurnRate: false,
  showAlerts: true,
  activityIndicator: true,
  treePrefixes: true,
  mergeToolsAgents: true,
  barStyle: 'classic',
  customLine: '',  // also ensure this existing field is included
},
// New top-level sections:
frameworks: {
  agw: { enabled: true, endpoint: 'http://localhost:3000' },
  agentTeams: { enabled: true },
},
alerts: {
  context: { warningThreshold: 70, criticalThreshold: 85, actions: { visual: true, bell: false, predict: true } },
  usage5h: { warningThreshold: 70, criticalThreshold: 90, actions: { visual: true, bell: true, predict: true } },
  usage7d: { warningThreshold: 80, actions: { visual: true, bell: false, predict: true } },
},
// Also ensure existing config.usage section is present:
usage: { cacheTtlSeconds: 60, failureCacheTtlSeconds: 15 },
```

- [ ] **Step 3: Run full test suite**

Run: `npm run build && npm test`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add tests/
git commit -m "test: update existing test mocks for new RenderContext and config fields"
```

---

## Task 14: End-to-End Verification

- [ ] **Step 1: Build and run full test suite**

Run: `npm run build && npm test`
Expected: All tests PASS, no TypeScript errors

- [ ] **Step 2: Manual smoke test with sample data**

Run: `echo '{"model":{"display_name":"Opus 4.6"},"context_window":{"current_usage":{"input_tokens":170000},"context_window_size":200000},"transcript_path":"/tmp/test.jsonl"}' | bun src/index.ts 2>&1`
Expected: Dashboard Rich output with activity indicator, bar, no crashes

- [ ] **Step 3: Test backward compatibility — no config**

Run: Remove `~/.claude/plugins/claude-hud/config.json` temporarily, run same command.
Expected: Identical to current version behavior (no new features visible)

- [ ] **Step 4: Test with full config**

Create config with all features enabled, verify all lines render.

- [ ] **Step 5: Final commit if needed**

```bash
git commit -m "chore: end-to-end verification complete"
```
