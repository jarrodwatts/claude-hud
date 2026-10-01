import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getHudPluginDir } from './claude-config-dir.js';
import { getNativeCostUsd } from './cost.js';
import { createDebug } from './debug.js';
import type { StdinData } from './types.js';
import { SEVEN_DAY_WINDOW_MS } from './usage-pace.js';

const debug = createDebug('daily-cost');

// Content changes always write; renders that only refresh last-seen times are throttled.
export const DAILY_COST_WRITE_THROTTLE_MS = 30_000;
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type LedgerSession = {
  // Native total when the session was first seen today, and inside the current week.
  baseline: number;
  weekBaseline: number;
  // Highest native total seen. Absolute rather than a delta, so a write lost to a
  // concurrent render is restored by the next one instead of drifting.
  total: number;
  ts: number;
};

type Ledger = {
  // Local calendar day, YYYYMMDD: the counter resets at the user's midnight.
  date: string;
  sessions: Record<string, LedgerSession>;
  // When weekly accumulation began, plus spend from sessions already dropped.
  week: { start: number; carry: number };
};

export type CostTotals = {
  todayUsd: number;
  // Null until the 7-day usage window's reset time is known.
  weekUsd: number | null;
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
  return path.join(getHudPluginDir(homeDir), 'daily-cost.json');
}

function localDateKey(now: number): string {
  const date = new Date(now);
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

const isAmount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function readLedger(ledgerPath: string): Ledger | null {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    if (!isObject(value) || typeof value.date !== 'string' || !/^\d{8}$/.test(value.date) || !isObject(value.sessions)) {
      return null;
    }
    const sessions: Record<string, LedgerSession> = {};
    for (const [id, raw] of Object.entries(value.sessions)) {
      if (!isObject(raw) || !isAmount(raw.baseline) || !isAmount(raw.total) || !isAmount(raw.ts) || raw.ts === 0) continue;
      // Ledgers written before weekly totals have no weekBaseline.
      const weekBaseline = isAmount(raw.weekBaseline) ? raw.weekBaseline : raw.baseline;
      sessions[id] = { baseline: raw.baseline, weekBaseline, total: raw.total, ts: raw.ts };
    }
    const week = isObject(value.week) ? value.week : {};
    return {
      date: value.date,
      sessions,
      week: { start: isAmount(week.start) ? week.start : 0, carry: isAmount(week.carry) ? week.carry : 0 },
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      debug('Failed to read ledger (starting fresh):', err instanceof Error ? err.message : err);
    }
    return null;
  }
}

function isThrottled(ledgerPath: string, now: number): boolean {
  try {
    return now - fs.statSync(ledgerPath).mtimeMs <= DAILY_COST_WRITE_THROTTLE_MS;
  } catch {
    return false;
  }
}

function writeLedger(ledgerPath: string, ledger: Ledger, now: number): void {
  const tmpPath = `${ledgerPath}.${process.pid}.${now}.tmp`;
  try {
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(tmpPath, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmpPath, ledgerPath);
    // The throttle reads mtime, so stamp it with the caller's clock.
    fs.utimesSync(ledgerPath, new Date(now), new Date(now));
  } catch (err) {
    debug('Failed to write ledger:', err instanceof Error ? err.message : err);
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      // Nothing left to clean up.
    }
  }
}

// Folds the session's native cost into the ledger and returns today's and this
// week's spend across sessions, or null when nothing has been recorded.
export function getCostTotals(
  stdin: StdinData,
  options?: { allowRoutedCost?: boolean; sevenDayResetAt?: Date | null },
  deps: DailyCostDeps = defaultDeps,
): CostTotals | null {
  const now = deps.now();
  const today = localDateKey(now);
  const ledgerPath = getDailyCostLedgerPath(deps.homeDir());
  const stored = readLedger(ledgerPath);
  const ledger: Ledger = stored ?? { date: today, sessions: {}, week: { start: now, carry: 0 } };
  let changed = stored === null;

  // Sessions unseen for a day leave the ledger, but their spend stays inside the week.
  for (const [id, session] of Object.entries(ledger.sessions)) {
    if (now - session.ts > SESSION_MAX_AGE_MS) {
      ledger.week.carry += Math.max(0, session.total - session.weekBaseline);
      delete ledger.sessions[id];
      changed = true;
    }
  }

  // At midnight, active sessions carry over so that only today's part of their spend counts.
  if (ledger.date !== today) {
    ledger.date = today;
    for (const session of Object.values(ledger.sessions)) session.baseline = session.total;
    changed = true;
  }

  // Restart the week when the quota window behind the Weekly bar opened after accumulation began.
  const resetAt = options?.sevenDayResetAt?.getTime();
  const windowStart = resetAt !== undefined && Number.isFinite(resetAt) ? resetAt - SEVEN_DAY_WINDOW_MS : null;
  if (windowStart !== null && ledger.week.start < windowStart) {
    for (const session of Object.values(ledger.sessions)) session.weekBaseline = session.total;
    ledger.week = { start: now, carry: 0 };
    changed = true;
  }

  const sessionId = typeof stdin.session_id === 'string' ? stdin.session_id.trim() : '';
  const nativeCost = getNativeCostUsd(stdin, options);
  if (sessionId && nativeCost !== null) {
    const session = ledger.sessions[sessionId];
    if (!session) {
      ledger.sessions[sessionId] = { baseline: nativeCost, weekBaseline: nativeCost, total: nativeCost, ts: now };
      changed = true;
    } else {
      if (nativeCost > session.total) {
        session.total = nativeCost;
        changed = true;
      }
      session.ts = now;
    }
  }

  const sessions = Object.values(ledger.sessions);
  if (sessions.length === 0 && ledger.week.carry === 0) {
    return null;
  }
  if (changed || !isThrottled(ledgerPath, now)) {
    writeLedger(ledgerPath, ledger, now);
  }

  const sum = (pick: (s: LedgerSession) => number): number =>
    sessions.reduce((total, s) => total + Math.max(0, s.total - pick(s)), 0);
  return {
    todayUsd: sum((s) => s.baseline),
    weekUsd: windowStart !== null ? ledger.week.carry + sum((s) => s.weekBaseline) : null,
  };
}
