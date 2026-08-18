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

type LedgerSession = {
  // Native total_cost_usd when the session was first seen today. Only the
  // increment above the baseline counts toward the day, so a session that
  // started yesterday contributes only what it spent today.
  baseline: number;
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
  const { baseline, total, ts } = session;
  if (
    typeof baseline !== 'number' || !Number.isFinite(baseline) || baseline < 0
    || typeof total !== 'number' || !Number.isFinite(total) || total < 0
    || typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0
  ) {
    return null;
  }
  return { baseline, total, ts };
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
    return { date: value.date, sessions };
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
 * cumulative spend across sessions, or null when nothing has been recorded.
 *
 * On each render the current session's entry is advanced to the highest
 * native total seen; the first sighting of a session today records the
 * baseline so only today's increment counts. At local midnight, still-active
 * sessions carry over with their baseline reset to the last known total.
 */
export function getDailyCostUsd(
  stdin: StdinData,
  options?: { allowRoutedCost?: boolean },
  deps: DailyCostDeps = defaultDeps,
): number | null {
  const now = deps.now();
  const today = localDateKey(now);
  const ledgerPath = getDailyCostLedgerPath(deps.homeDir());

  let ledger = readLedger(ledgerPath);
  let changed = ledger === null;
  ledger ??= { date: today, sessions: {} };

  if (ledger.date !== today) {
    // Day rollover: carry recently seen sessions over with baseline reset to
    // their last known total, so a session spanning midnight contributes only
    // today's part. Everything else starts from a clean slate.
    const carried: Record<string, LedgerSession> = {};
    for (const [id, session] of Object.entries(ledger.sessions)) {
      if (now - session.ts <= SESSION_MAX_AGE_MS) {
        carried[id] = { baseline: session.total, total: session.total, ts: session.ts };
      }
    }
    ledger = { date: today, sessions: carried };
    changed = true;
  }

  for (const [id, session] of Object.entries(ledger.sessions)) {
    if (now - session.ts > SESSION_MAX_AGE_MS) {
      delete ledger.sessions[id];
      changed = true;
    }
  }

  const sessionId = typeof stdin.session_id === 'string' ? stdin.session_id.trim() : '';
  const nativeCost = getNativeCostUsd(stdin, options);
  if (sessionId && nativeCost !== null && nativeCost >= 0) {
    const existing = ledger.sessions[sessionId];
    if (!existing) {
      ledger.sessions[sessionId] = { baseline: nativeCost, total: nativeCost, ts: now };
      changed = true;
    } else {
      if (nativeCost > existing.total) {
        existing.total = nativeCost;
        changed = true;
      }
      existing.ts = now;
    }
  }

  if (Object.keys(ledger.sessions).length === 0) {
    return null;
  }

  if (shouldWriteLedger(ledgerPath, changed, now)) {
    writeLedger(ledgerPath, ledger, now);
  }

  let totalUsd = 0;
  for (const session of Object.values(ledger.sessions)) {
    totalUsd += Math.max(0, session.total - session.baseline);
  }
  return Number.isFinite(totalUsd) ? totalUsd : null;
}
