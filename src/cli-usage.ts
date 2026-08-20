import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getClaudeConfigJsonPath, getHudPluginDir } from './claude-config-dir.js';
import { parseScopedWindows } from './stdin.js';
import { createDebug } from './debug.js';
import type { ScopedUsageWindow } from './types.js';

const debug = createDebug('cli-usage');

/**
 * Feeds model-scoped weekly usage (e.g. the Fable window on /usage) from the
 * cache Claude Code itself maintains, without touching credentials or the
 * network.
 *
 * Recent Claude Code releases surface model-scoped weekly windows on /usage,
 * and the CLI persists each /usage fetch into {CLAUDE_CONFIG_DIR}.json under
 * `cachedUsageUtilization` (limits[] entries whose scope.model names the
 * window). Statusline stdin still lacks rate_limits.model_scoped (#669), so
 * until Claude Code forwards it, this module:
 *
 *   1. always reads that cache on render as the lowest-priority scoped-window
 *      source (a plain local file read — no subprocess, no network), and
 *   2. only when display.refreshModelScopedUsage is enabled and the cache is
 *      stale, spawns a single detached, headless `claude -p /usage` so the
 *      CLI refreshes its own cache — the CLI resolves auth itself, and the
 *      HUD never sees a token.
 *
 * Stdin wins whenever it starts carrying scoped windows; this feeder then
 * never runs (see index.ts) and can eventually be retired.
 */

/**
 * Refresh interval. Fixed at five minutes: Claude Code throttles writes of
 * `cachedUsageUtilization` to once per five minutes, so refreshing more often
 * cannot yield newer data.
 */
export const CLI_USAGE_REFRESH_MS = 300_000;

/**
 * Claude Code treats its own usage cache as stale after one hour; mirror that
 * bound so the HUD never renders older data than /usage itself would trust.
 */
export const CLI_USAGE_MAX_AGE_MS = 3_600_000;

/**
 * After scheduling one refresh, hold off re-spawning for this long. The
 * statusline renders far more often than a headless `claude -p /usage`
 * completes (a few seconds), so without this a stale cache would stampede
 * one subprocess per render until the first one lands.
 */
export const CLI_USAGE_REFRESH_HOLDOFF_MS = 120_000;

const REFRESH_MARKER_FILENAME = 'cli-usage-refresh.marker';

type SpawnLike = (
  command: string,
  args: string[],
  options: { detached: boolean; stdio: 'ignore' },
) => { unref: () => void; on: (event: string, listener: (...args: unknown[]) => void) => unknown };

export type CliUsageDeps = {
  homeDir: () => string;
  readFileSync: typeof fs.readFileSync;
  statSync: typeof fs.statSync;
  mkdirSync: typeof fs.mkdirSync;
  writeFileSync: typeof fs.writeFileSync;
  utimesSync: typeof fs.utimesSync;
  spawn: SpawnLike;
};

const defaultDeps: CliUsageDeps = {
  homeDir: () => os.homedir(),
  readFileSync: fs.readFileSync,
  statSync: fs.statSync,
  mkdirSync: fs.mkdirSync,
  writeFileSync: fs.writeFileSync,
  utimesSync: fs.utimesSync,
  spawn: spawn as unknown as SpawnLike,
};

export type CliUsageCache = {
  fetchedAtMs: number;
  scopedWindows: ScopedUsageWindow[];
};

/**
 * Reads `cachedUsageUtilization` from {CLAUDE_CONFIG_DIR}.json and projects
 * its model-scoped limits[] entries into ScopedUsageWindow[]. Model names are
 * taken from the cache verbatim (no hardcoded model list), so any future
 * model-scoped window is picked up automatically. Returns null when the file,
 * the cache block, or its timestamp is missing or malformed. Never throws.
 */
export function readCliUsageCache(deps: CliUsageDeps = defaultDeps): CliUsageCache | null {
  const configJsonPath = getClaudeConfigJsonPath(deps.homeDir());
  let root: unknown;
  try {
    root = JSON.parse(deps.readFileSync(configJsonPath, 'utf8') as string);
  } catch (err) {
    debug('Failed to read claude config json:', err instanceof Error ? err.message : err);
    return null;
  }

  const cached = (root && typeof root === 'object')
    ? (root as Record<string, unknown>).cachedUsageUtilization
    : null;
  if (!cached || typeof cached !== 'object' || Array.isArray(cached)) {
    return null;
  }

  const cachedRecord = cached as Record<string, unknown>;
  const fetchedAtMs = cachedRecord.fetchedAtMs;
  if (typeof fetchedAtMs !== 'number' || !Number.isFinite(fetchedAtMs) || fetchedAtMs <= 0) {
    return null;
  }

  const utilization = cachedRecord.utilization;
  const limits = (utilization && typeof utilization === 'object')
    ? (utilization as Record<string, unknown>).limits
    : null;

  const modelScoped: Array<{ display_name?: unknown; utilization?: unknown; resets_at?: unknown }> = [];
  if (Array.isArray(limits)) {
    for (const raw of limits) {
      const entry = raw as {
        scope?: { model?: { display_name?: unknown } | null } | null;
        percent?: unknown;
        resets_at?: unknown;
      } | null;
      const displayName = entry?.scope?.model?.display_name;
      if (typeof displayName !== 'string' || !displayName.trim()) {
        continue;
      }
      modelScoped.push({
        display_name: displayName,
        utilization: entry?.percent,
        resets_at: entry?.resets_at,
      });
    }
  }

  return {
    fetchedAtMs,
    // parseScopedWindows applies the shared bounds: entry cap, label
    // sanitization/length cap, percent clamping, reset-string validation.
    scopedWindows: parseScopedWindows(modelScoped),
  };
}

function refreshMarkerPath(homeDir: string): string {
  return path.join(getHudPluginDir(homeDir), REFRESH_MARKER_FILENAME);
}

function markerIsRecent(markerPath: string, now: number, deps: CliUsageDeps): boolean {
  try {
    const stat = deps.statSync(markerPath);
    const age = now - stat.mtimeMs;
    return age >= 0 && age < CLI_USAGE_REFRESH_HOLDOFF_MS;
  } catch {
    return false;
  }
}

function touchMarker(markerPath: string, now: number, deps: CliUsageDeps): boolean {
  try {
    deps.mkdirSync(path.dirname(markerPath), { recursive: true, mode: 0o700 });
    deps.writeFileSync(markerPath, '', { encoding: 'utf8', mode: 0o600 });
    const date = new Date(now);
    deps.utimesSync(markerPath, date, date);
    return true;
  } catch (err) {
    debug('Failed to touch refresh marker:', err instanceof Error ? err.message : err);
    return false;
  }
}

function scheduleRefresh(now: number, deps: CliUsageDeps): boolean {
  const markerPath = refreshMarkerPath(deps.homeDir());
  if (markerIsRecent(markerPath, now, deps)) {
    return false;
  }
  // Claim the slot before spawning so concurrent renders (multiple sessions
  // share one statusline binary) do not race into duplicate subprocesses.
  if (!touchMarker(markerPath, now, deps)) {
    return false;
  }

  try {
    // Headless /usage is a local command: Claude Code fetches usage, rewrites
    // its cache, and exits without invoking a model. No shell is involved and
    // no output is consumed — the cache file is the only channel.
    const child = deps.spawn('claude', ['-p', '/usage'], {
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', (err: unknown) => {
      debug('Refresh spawn failed:', err instanceof Error ? err.message : err);
    });
    child.unref();
    return true;
  } catch (err) {
    debug('Refresh spawn failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Returns fresh model-scoped windows from the Claude CLI's own usage cache.
 * Reading is unconditional; `refreshEnabled` (display.refreshModelScopedUsage)
 * additionally schedules a background refresh when the cache is stale. Single
 * entry point used by main(); reads the cache once per render. Never throws.
 */
export function getScopedUsageFromCliCache(
  now: number,
  refreshEnabled: boolean,
  deps: CliUsageDeps = defaultDeps,
): ScopedUsageWindow[] | null {
  const cache = readCliUsageCache(deps);

  const age = cache ? now - cache.fetchedAtMs : Number.POSITIVE_INFINITY;
  if (refreshEnabled && (age >= CLI_USAGE_REFRESH_MS || age < 0)) {
    scheduleRefresh(now, deps);
  }

  if (!cache || age < 0 || age > CLI_USAGE_MAX_AGE_MS) {
    return null;
  }

  return cache.scopedWindows.length > 0 ? cache.scopedWindows : null;
}
