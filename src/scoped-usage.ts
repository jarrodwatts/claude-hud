/**
 * Model-scoped weekly usage windows (e.g. the Fable weekly quota).
 *
 * Claude Code's statusline stdin only carries the generic five_hour/seven_day
 * rate limits. Premium models (Fable/Mythos class) have an additional
 * `weekly_scoped` window that is only visible via the OAuth usage API
 * (the same source the /usage screen uses):
 *
 *   GET https://api.anthropic.com/api/oauth/usage
 *   → limits[] entries with kind="weekly_scoped" and scope.model.display_name
 *
 * Strategy: stale-while-revalidate file cache so the statusline render path
 * never blocks on the network or keychain.
 *  - Fresh cache (< TTL): read the cache file only.
 *  - Stale/missing: serve stale data for this tick and spawn a detached
 *    background refresh (`node scoped-usage.js --refresh`) that reads the
 *    OAuth token from the macOS keychain (or ~/.claude/.credentials.json)
 *    and rewrites the cache. The token never leaves the refresh process
 *    and is never logged or rendered.
 *
 * Opt-in via `display.showScopedUsage` (default false) because the refresh
 * process reads the Claude Code OAuth credential store.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import type { ScopedUsageWindow } from './types.js';

export type { ScopedUsageWindow };

interface ScopedUsageCacheFile {
  updated_at: number;
  windows: Array<{ label: string; percent: number; resets_at: string | null }>;
}

export interface ScopedUsageOptions {
  /** Cache directory override (tests). Defaults to ~/.claude/plugins/claude-hud/scoped-usage-cache. */
  cacheDir?: string;
  /** Set false to suppress the background refresh spawn (tests). */
  triggerRefresh?: boolean;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
/** After this long without a successful refresh, hide the data instead of showing stale values. */
const CACHE_MAX_AGE_MS = 60 * 60 * 1000;
const REFRESH_MARKER_TTL_MS = 60 * 1000;

function defaultCacheDir(): string {
  return path.join(os.homedir(), '.claude', 'plugins', 'claude-hud', 'scoped-usage-cache');
}

function cachePath(dir: string): string {
  return path.join(dir, 'cache.json');
}

function refreshMarkerPath(dir: string): string {
  return path.join(dir, 'refreshing');
}

/**
 * Read model-scoped weekly windows for the HUD. Never blocks on the network:
 * serves cached data and triggers a detached background refresh when stale.
 */
export function getScopedUsage(now: number = Date.now(), options: ScopedUsageOptions = {}): ScopedUsageWindow[] {
  const dir = options.cacheDir ?? defaultCacheDir();
  let cache: ScopedUsageCacheFile | null = null;
  try {
    cache = JSON.parse(fs.readFileSync(cachePath(dir), 'utf8')) as ScopedUsageCacheFile;
  } catch {
    cache = null;
  }

  const age = cache && typeof cache.updated_at === 'number' ? now - cache.updated_at : Infinity;
  if (age >= CACHE_TTL_MS && options.triggerRefresh !== false) {
    triggerBackgroundRefresh(dir, now);
  }
  if (!cache || !Array.isArray(cache.windows) || age >= CACHE_MAX_AGE_MS) {
    return [];
  }

  return cache.windows
    .filter((w) => typeof w?.percent === 'number' && typeof w?.label === 'string' && w.label.length > 0)
    .map((w) => ({
      label: w.label,
      percent: Math.max(0, Math.min(100, w.percent)),
      resetAt: w.resets_at ? new Date(w.resets_at) : null,
    }));
}

/** Spawn a detached refresh process at most once per marker TTL. Best-effort — never throws. */
function triggerBackgroundRefresh(dir: string, now: number): void {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      const markerAge = now - fs.statSync(refreshMarkerPath(dir)).mtimeMs;
      if (markerAge < REFRESH_MARKER_TTL_MS) return; // refresh already in flight
    } catch {
      // no marker — proceed
    }
    fs.writeFileSync(refreshMarkerPath(dir), String(now), { mode: 0o600 });
    const child = spawn(process.execPath, [fileURLToPathSafe(import.meta.url), '--refresh'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch {
    // best-effort — the HUD must never break on refresh scheduling
  }
}

function fileURLToPathSafe(url: string): string {
  return url.startsWith('file://') ? new URL(url).pathname : url;
}

// ── Refresh path (runs in a detached child, never in the render path) ──

function readOAuthToken(): string | null {
  // Primary: the macOS keychain entry Claude Code maintains.
  try {
    const out = spawnSync('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    if (out.status === 0 && out.stdout.trim()) {
      const creds = JSON.parse(out.stdout.trim()) as { claudeAiOauth?: { accessToken?: string } };
      const token = creds.claudeAiOauth?.accessToken;
      if (token) return token;
    }
  } catch {
    // fall through
  }
  // Fallback: credentials file (Linux / setups without keychain).
  try {
    const raw = fs.readFileSync(path.join(os.homedir(), '.claude', '.credentials.json'), 'utf8');
    const creds = JSON.parse(raw) as { claudeAiOauth?: { accessToken?: string } };
    return creds.claudeAiOauth?.accessToken ?? null;
  } catch {
    return null;
  }
}

interface OAuthUsageLimit {
  kind?: string;
  percent?: number;
  resets_at?: string | null;
  scope?: { model?: { display_name?: string | null } | null } | null;
}

/** Extract model-scoped weekly windows from an OAuth usage API response body. */
export function parseScopedLimits(body: unknown): ScopedUsageCacheFile['windows'] {
  const limits = (body as { limits?: OAuthUsageLimit[] } | null)?.limits;
  if (!Array.isArray(limits)) return [];
  return limits
    .filter(
      (l) =>
        l?.kind === 'weekly_scoped'
        && typeof l.percent === 'number'
        && typeof l.scope?.model?.display_name === 'string'
        && l.scope.model.display_name.length > 0,
    )
    .map((l) => ({
      label: String(l.scope!.model!.display_name),
      percent: l.percent as number,
      resets_at: l.resets_at ?? null,
    }));
}

export interface RefreshOptions {
  cacheDir?: string;
  /** Token override (tests). Defaults to the Claude Code credential store. */
  token?: string | null;
  /** Fetch override (tests). */
  fetchImpl?: typeof fetch;
}

export async function refreshScopedUsage(options: RefreshOptions = {}): Promise<void> {
  const dir = options.cacheDir ?? defaultCacheDir();
  const token = options.token !== undefined ? options.token : readOAuthToken();
  const doFetch = options.fetchImpl ?? fetch;
  if (!token) return;
  try {
    const res = await doFetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return;
    const windows = parseScopedLimits(await res.json());
    const cache: ScopedUsageCacheFile = { updated_at: Date.now(), windows };
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(cachePath(dir), JSON.stringify(cache), { mode: 0o600 });
  } catch {
    // best-effort — keep the previous cache on failure
  } finally {
    try {
      fs.unlinkSync(refreshMarkerPath(dir));
    } catch {
      // ignore
    }
  }
}

if (process.argv.includes('--refresh')) {
  void refreshScopedUsage();
}
