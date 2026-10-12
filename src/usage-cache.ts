import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getHudPluginDir } from './claude-config-dir.js';
import { createDebug } from './debug.js';
import type { UsageData } from './types.js';
import { FIVE_HOUR_WINDOW_MS, SEVEN_DAY_WINDOW_MS } from './usage-pace.js';

const debug = createDebug('usage-cache');

type CachedWindow = {
  used_percentage: number;
  // Epoch milliseconds, or null when the payload carried no reset time.
  resets_at: number | null;
  saved_at: number;
};

type UsageCache = {
  five_hour: CachedWindow | null;
  seven_day: CachedWindow | null;
};

const EMPTY_CACHE: UsageCache = { five_hour: null, seven_day: null };

// Rate limits belong to the account, not the session, so one file per config directory.
export function getUsageCachePath(homeDir: string): string {
  return path.join(getHudPluginDir(homeDir), 'usage-cache.json');
}

const isPercent = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;

const isTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

function parseWindow(value: unknown): CachedWindow | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!isPercent(raw.used_percentage) || !isTimestamp(raw.saved_at)) return null;
  if (raw.resets_at !== null && !isTimestamp(raw.resets_at)) return null;
  return { used_percentage: raw.used_percentage, resets_at: raw.resets_at, saved_at: raw.saved_at };
}

function readCache(file: string): UsageCache {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return EMPTY_CACHE;
    const raw = value as Record<string, unknown>;
    return { five_hour: parseWindow(raw.five_hour), seven_day: parseWindow(raw.seven_day) };
  } catch (err) {
    if (!(err instanceof Error && 'code' in err && err.code === 'ENOENT')) {
      debug('Failed to read usage cache:', err instanceof Error ? err.message : err);
    }
    return EMPTY_CACHE;
  }
}

function writeCache(file: string, cache: UsageCache): void {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(tmp, `${JSON.stringify(cache, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, file);
  } catch (err) {
    debug('Failed to write usage cache:', err instanceof Error ? err.message : err);
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // Nothing left to clean up.
    }
  }
}

// A remembered window is only worth showing until it resets. Without a reset time the
// best bound is the window length itself.
function isLive(window: CachedWindow | null, windowMs: number, now: number): CachedWindow | null {
  if (!window) return null;
  const expiresAt = window.resets_at ?? window.saved_at + windowMs;
  return expiresAt > now ? window : null;
}

function toCached(percent: number | null, resetAt: Date | null, now: number): CachedWindow | null {
  return percent === null ? null : { used_percentage: percent, resets_at: resetAt?.getTime() ?? null, saved_at: now };
}

const sameValues = (a: CachedWindow | null, b: CachedWindow | null): boolean =>
  a?.used_percentage === b?.used_percentage && a?.resets_at === b?.resets_at;

/**
 * Fills the 5h and 7d windows stdin left out from the last values stdin carried.
 *
 * Claude Code does not send both windows on every refresh. Rendering only what
 * arrived makes the usage line flip between `5h` and `Weekly` from one refresh to
 * the next. Stdin always wins; a remembered window is dropped once it resets.
 * Windows that arrive on stdin are written back so the next render can use them.
 */
export function withLastKnownUsage(
  stdinUsage: UsageData | null,
  now: number = Date.now(),
  homeDir: string = os.homedir(),
): UsageData | null {
  const file = getUsageCachePath(homeDir);
  const cached = readCache(file);
  const stdinFiveHour = toCached(stdinUsage?.fiveHour ?? null, stdinUsage?.fiveHourResetAt ?? null, now);
  const stdinSevenDay = toCached(stdinUsage?.sevenDay ?? null, stdinUsage?.sevenDayResetAt ?? null, now);

  const next: UsageCache = {
    five_hour: stdinFiveHour ?? cached.five_hour,
    seven_day: stdinSevenDay ?? cached.seven_day,
  };
  if (stdinUsage && (!sameValues(next.five_hour, cached.five_hour) || !sameValues(next.seven_day, cached.seven_day))) {
    writeCache(file, next);
  }

  const fiveHour = stdinFiveHour ?? isLive(cached.five_hour, FIVE_HOUR_WINDOW_MS, now);
  const sevenDay = stdinSevenDay ?? isLive(cached.seven_day, SEVEN_DAY_WINDOW_MS, now);
  if (!fiveHour && !sevenDay) {
    return stdinUsage;
  }
  return {
    ...stdinUsage,
    fiveHour: fiveHour?.used_percentage ?? null,
    sevenDay: sevenDay?.used_percentage ?? null,
    fiveHourResetAt: fiveHour?.resets_at != null ? new Date(fiveHour.resets_at) : null,
    sevenDayResetAt: sevenDay?.resets_at != null ? new Date(sevenDay.resets_at) : null,
  };
}
