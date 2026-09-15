import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getHudPluginDir } from './claude-config-dir.js';
import { getNativeCostUsd } from './cost.js';
import { createDebug } from './debug.js';
import type { StdinData } from './types.js';

const debug = createDebug('daily-cost');

const LEDGER_FILENAME = 'daily-cost.json';

/**
 * Minimum interval between ledger rewrites when the accounted content did not
 * change, mirroring the external-usage snapshot semantics: content changes
 * (a higher total, a new session, day rollover) always write, while renders
 * that only refresh last-seen timestamps are throttled. Status line refreshes
 * are event-driven and can fire in rapid bursts (debounced at 300ms).
 */
export const DAILY_COST_WRITE_THROTTLE_MS = 30_000;

/** Sessions unseen for longer than this are dropped so the ledger stays bounded. */
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Length of the weekly quota window the cost accumulator is aligned to. */
const SEVEN_DAY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type LedgerSession = {
  // Native total_cost_usd when the session was first seen today. Only the
  // increment above the baseline counts toward the day, so a session that
  // started yesterday contributes only what it spent today.
  baseline: number;
  // Same idea for the weekly quota window: native total when the session was
  // first seen inside the current window, so only spend since the window
  // opened counts toward the week.
  weekBaseline: number;
  // Highest native total_cost_usd seen for the session. Storing the absolute
  // total rather than a delta makes the ledger self-healing: if two
  // concurrent renders clobber each other's write, the next render restores
  // the correct value instead of drifting.
  total: number;
  // Last time the session was seen (ms since epoch).
  ts: number;
};

type Ledger = {
  // Local calendar day the ledger covers, as YYYYMMDD.
  date: string;
  sessions: Record<string, LedgerSession>;
  // The weekly quota window the accumulator covers. `resetAt` is the 7d reset
  // reported by the usage data (ms since epoch, null while unknown), `start`
  // when accumulation for this window began, and `carry` the spend of sessions
  // already dropped from `sessions` but still inside the window.
  week: { resetAt: number | null; start: number; carry: number };
};

export type CostTotals = {
  todayUsd: number;
  weekUsd: number;
};

export type DailyCostDeps = {
  homeDir: () => string;
  now: () => number;
};

const defaultDeps: DailyCostDeps = {
  homeDir: () => os.homedir(),
  now: () => Date.now(),
};

export function getDailyCostLedgerPath(homeDir: string): string {
  return path.join(getHudPluginDir(homeDir), LEDGER_FILENAME);
}

// Day boundaries follow the local clock, so the counter resets at the user's
// midnight rather than at UTC midnight.
function localDateKey(now: number): string {
  const date = new Date(now);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}${month}${day}`;
}

function parseLedgerSession(value: unknown): LedgerSession | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const session = value as Record<string, unknown>;
  const { baseline, total, ts, weekBaseline } = session;
  if (
    typeof baseline !== 'number' || !Number.isFinite(baseline) || baseline < 0
    || typeof total !== 'number' || !Number.isFinite(total) || total < 0
    || typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0
  ) {
    return null;
  }
  // Ledgers written before the weekly window existed fall back to the day
  // baseline, so the week starts out counting today's spend rather than none.
  const week = typeof weekBaseline === 'number' && Number.isFinite(weekBaseline) && weekBaseline >= 0
    ? weekBaseline
    : baseline;
  return { baseline, weekBaseline: week, total, ts };
}

function parseWeek(value: unknown): Ledger['week'] {
  const fallback = { resetAt: null, start: 0, carry: 0 };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback;
  }
  const { resetAt, start, carry } = value as Record<string, unknown>;
  return {
    resetAt: typeof resetAt === 'number' && Number.isFinite(resetAt) && resetAt > 0 ? resetAt : null,
    start: typeof start === 'number' && Number.isFinite(start) && start > 0 ? start : 0,
    carry: typeof carry === 'number' && Number.isFinite(carry) && carry >= 0 ? carry : 0,
  };
}

function readLedger(ledgerPath: string): Ledger | null {
  try {
    if (!fs.existsSync(ledgerPath)) {
      return null;
    }
    const parsed = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const value = parsed as Record<string, unknown>;
    if (typeof value.date !== 'string' || !/^\d{8}$/.test(value.date)) {
      return null;
    }
    if (!value.sessions || typeof value.sessions !== 'object' || Array.isArray(value.sessions)) {
      return null;
    }
    const sessions: Record<string, LedgerSession> = {};
    for (const [id, raw] of Object.entries(value.sessions)) {
      const session = parseLedgerSession(raw);
      if (session) {
        sessions[id] = session;
      }
    }
    return { date: value.date, sessions, week: parseWeek(value.week) };
  } catch (err) {
    debug('Failed to read ledger (starting fresh):', err instanceof Error ? err.message : err);
    return null;
  }
}

function shouldWriteLedger(ledgerPath: string, changed: boolean, now: number): boolean {
  if (changed) {
    return true;
  }
  try {
    const stats = fs.statSync(ledgerPath);
    return now - stats.mtimeMs > DAILY_COST_WRITE_THROTTLE_MS;
  } catch {
    return true;
  }
}

function writeLedger(ledgerPath: string, ledger: Ledger, now: number): void {
  const dir = path.dirname(ledgerPath);
  const base = path.basename(ledgerPath);
  const tmpPath = path.join(
    dir,
    `.${base}.${process.pid}.${now}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(tmpPath, `${JSON.stringify(ledger, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    fs.renameSync(tmpPath, ledgerPath);
    fs.chmodSync(ledgerPath, 0o600);
    // Keep the throttle anchored to the caller's clock rather than the
    // filesystem's, so an injected clock (tests) stays consistent.
    fs.utimesSync(ledgerPath, new Date(now), new Date(now));
  } catch (err) {
    debug('Failed to write ledger:', err instanceof Error ? err.message : err);
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch (cleanupErr) {
      debug('Failed to clean up temp file:', cleanupErr instanceof Error ? cleanupErr.message : cleanupErr);
    }
  }
}

/**
 * Accumulate the native stdin cost into a per-day ledger and return today's
 * cumulative spend across sessions plus the spend since the weekly quota
 * window opened, or null when nothing has been recorded.
 *
 * On each render the current session's entry is advanced to the highest
 * native total seen; the first sighting of a session today records the
 * baseline so only today's increment counts. At local midnight, still-active
 * sessions carry over with their baseline reset to the last known total.
 */
export function getCostTotals(
  stdin: StdinData,
  options?: { allowRoutedCost?: boolean; sevenDayResetAt?: Date | null },
  deps: DailyCostDeps = defaultDeps,
): CostTotals | null {
  const now = deps.now();
  const today = localDateKey(now);
  const ledgerPath = getDailyCostLedgerPath(deps.homeDir());

  let ledger = readLedger(ledgerPath);
  let changed = ledger === null;
  ledger ??= { date: today, sessions: {}, week: { resetAt: null, start: now, carry: 0 } };

  if (ledger.date !== today) {
    // Day rollover: carry recently seen sessions over with baseline reset to
    // their last known total, so a session spanning midnight contributes only
    // today's part. Everything else starts from a clean slate.
    const carried: Record<string, LedgerSession> = {};
    const week = { ...ledger.week };
    for (const [id, session] of Object.entries(ledger.sessions)) {
      if (now - session.ts <= SESSION_MAX_AGE_MS) {
        carried[id] = { ...session, baseline: session.total };
      } else {
        // Dropped from the ledger, but its spend stays inside the week.
        week.carry += Math.max(0, session.total - session.weekBaseline);
      }
    }
    ledger = { date: today, sessions: carried, week };
    changed = true;
  }

  // Align the weekly accumulator with the quota window behind the `Weekly`
  // usage bar: it must have started after the window opened, otherwise it
  // covers spend from a previous window and has to restart. Without a known
  // reset time the window falls back to seven days from the first render.
  const resetAt = options?.sevenDayResetAt?.getTime() ?? null;
  const windowStart = resetAt !== null && Number.isFinite(resetAt)
    ? resetAt - SEVEN_DAY_WINDOW_MS
    : null;
  const expired = windowStart !== null
    ? ledger.week.start < windowStart
    : now - ledger.week.start >= SEVEN_DAY_WINDOW_MS;
  if (expired) {
    for (const session of Object.values(ledger.sessions)) {
      session.weekBaseline = session.total;
    }
    ledger.week = { resetAt, start: now, carry: 0 };
    changed = true;
  } else if (resetAt !== null && ledger.week.resetAt !== resetAt) {
    ledger.week = { ...ledger.week, resetAt };
    changed = true;
  }

  for (const [id, session] of Object.entries(ledger.sessions)) {
    if (now - session.ts > SESSION_MAX_AGE_MS) {
      // The session leaves the ledger but its spend stays inside the week.
      ledger.week.carry += Math.max(0, session.total - session.weekBaseline);
      delete ledger.sessions[id];
      changed = true;
    }
  }

  const sessionId = typeof stdin.session_id === 'string' ? stdin.session_id.trim() : '';
  const nativeCost = getNativeCostUsd(stdin, options);
  if (sessionId && nativeCost !== null && nativeCost >= 0) {
    const existing = ledger.sessions[sessionId];
    if (!existing) {
      ledger.sessions[sessionId] = { baseline: nativeCost, weekBaseline: nativeCost, total: nativeCost, ts: now };
      changed = true;
    } else {
      if (nativeCost > existing.total) {
        existing.total = nativeCost;
        changed = true;
      }
      existing.ts = now;
    }
  }

  if (Object.keys(ledger.sessions).length === 0 && ledger.week.carry === 0) {
    return null;
  }

  let todayUsd = 0;
  for (const session of Object.values(ledger.sessions)) {
    todayUsd += Math.max(0, session.total - session.baseline);
  }
  if (!Number.isFinite(todayUsd)) {
    return null;
  }

  if (shouldWriteLedger(ledgerPath, changed, now)) {
    writeLedger(ledgerPath, ledger, now);
  }

  let weekUsd = ledger.week.carry;
  for (const session of Object.values(ledger.sessions)) {
    weekUsd += Math.max(0, session.total - session.weekBaseline);
  }
  return { todayUsd, weekUsd: Number.isFinite(weekUsd) ? weekUsd : todayUsd };
}

/** Today's cumulative spend across sessions, or null when nothing is recorded. */
export function getDailyCostUsd(
  stdin: StdinData,
  options?: { allowRoutedCost?: boolean },
  deps: DailyCostDeps = defaultDeps,
): number | null {
  return getCostTotals(stdin, options, deps)?.todayUsd ?? null;
}
