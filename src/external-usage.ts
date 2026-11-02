import type { HudConfig } from './config.ts';
import { createDebug } from './debug.ts';
import type { ExternalUsageSnapshot, ScopedUsageWindow, UsageData } from './types.ts';
import { displayLabel } from './utils/sanitize.ts';

// collector.mjs reads and writes the files at display.externalUsagePath and externalUsageWritePath;
// this side only parses what it read and decides what to write.

const debug = createDebug('external-usage');

export const EXTERNAL_USAGE_WRITE_THROTTLE_MS = 30_000;
const MAX_BALANCE_LABEL_LENGTH = 50;
const SCOPED_WINDOWS_MAX = 8;
const SCOPED_LABEL_MAX_LENGTH = 64;

type WrittenWindow = { used_percentage: number | null; resets_at: string | null };
export type WrittenSnapshot = { updated_at: string; five_hour: WrittenWindow; seven_day: WrittenWindow };
/** The `usage.target` probe's answer: the file now at the write path, or null when that path can't be written. */
export type UsageTarget = { text: string | null; mtimeMs: number | null } | null | undefined;

function parseUsagePercent(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.min(100, Math.max(0, value))) : null;
}

function parseBalanceLabel(value: unknown): string | null {
  return displayLabel(value, MAX_BALANCE_LABEL_LENGTH, '...') || null;
}

// Epoch seconds or milliseconds, or an ISO-8601 string.
function parseDate(value: unknown): Date | null {
  let date: Date | null = null;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    date = new Date(value > 1e12 ? value : value * 1000);
  } else if (typeof value === 'string' && value.trim()) {
    date = new Date(value);
  }
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

// model_scoped windows ({ display_name, utilization 0-100, resets_at ISO-8601 }). The
// snapshot is untrusted, so entries are bounded and malformed ones dropped.
function parseScopedWindows(value: unknown): ScopedUsageWindow[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const windows: ScopedUsageWindow[] = [];
  for (const entry of value) {
    if (windows.length >= SCOPED_WINDOWS_MAX) break;
    const label = displayLabel(entry?.display_name, SCOPED_LABEL_MAX_LENGTH);
    const percent = entry?.utilization === null ? null : parseUsagePercent(entry?.utilization);
    if (!label || (entry?.utilization !== null && percent === null)) continue;
    const resetAt = typeof entry?.resets_at === 'string' && !Number.isNaN(Date.parse(entry.resets_at))
      ? new Date(entry.resets_at)
      : null;
    windows.push({ label, percent, resetAt });
  }
  return windows;
}


// Rewrite when the values change or the snapshot is older than the throttle, so readers
// can trust updated_at without the file being rewritten on every render.
function shouldWrite(current: NonNullable<UsageTarget>, next: WrittenSnapshot, now: number): boolean {
  if (current.text === null || current.mtimeMs === null || now - current.mtimeMs > EXTERNAL_USAGE_WRITE_THROTTLE_MS) {
    return true;
  }
  try {
    const { updated_at: _, ...stored } = JSON.parse(current.text);
    const { updated_at: __, ...values } = next;
    return JSON.stringify(stored) !== JSON.stringify(values);
  } catch {
    return true;
  }
}

// Stdin's rate limits for other local tools, or null when there is nothing new to write.
export function externalUsageSnapshot(
  target: UsageTarget,
  usage: UsageData | null,
  now = Date.now(),
): WrittenSnapshot | null {
  if (!target || !usage || (usage.fiveHour === null && usage.sevenDay === null)) return null;
  const snapshot: WrittenSnapshot = {
    updated_at: new Date(now).toISOString(),
    five_hour: { used_percentage: usage.fiveHour, resets_at: usage.fiveHourResetAt?.toISOString() ?? null },
    seven_day: { used_percentage: usage.sevenDay, resets_at: usage.sevenDayResetAt?.toISOString() ?? null },
  };
  return shouldWrite(target, snapshot, now) ? snapshot : null;
}

export function getUsageFromExternalSnapshot(text: unknown, config: HudConfig, now = Date.now()): UsageData | null {
  if (typeof text !== 'string') {
    return null;
  }

  try {
    const parsed = JSON.parse(text) as ExternalUsageSnapshot;
    const updatedAt = parseDate(parsed.updated_at)?.getTime();
    if (updatedAt === undefined || now - updatedAt > config.display.externalUsageFreshnessMs) {
      return null;
    }

    const fiveHour = parseUsagePercent(parsed.five_hour?.used_percentage);
    const sevenDay = parseUsagePercent(parsed.seven_day?.used_percentage);
    const balanceLabel = parseBalanceLabel(parsed.balance_label);
    const scopedWindows = parseScopedWindows(parsed.model_scoped);
    if (fiveHour === null && sevenDay === null && balanceLabel === null && scopedWindows.length === 0) {
      return null;
    }

    // A reset time that is present but unreadable means a broken snapshot, not a missing one.
    const fiveHourResetAt = parseDate(parsed.five_hour?.resets_at);
    const sevenDayResetAt = parseDate(parsed.seven_day?.resets_at);
    if ((parsed.five_hour?.resets_at != null && !fiveHourResetAt) || (parsed.seven_day?.resets_at != null && !sevenDayResetAt)) {
      return null;
    }

    return {
      fiveHour,
      sevenDay,
      fiveHourResetAt,
      sevenDayResetAt,
      ...(balanceLabel !== null && { balanceLabel }),
      ...(scopedWindows.length > 0 && { scopedWindows }),
    };
  } catch (err) {
    debug('Failed to read external usage snapshot:', err instanceof Error ? err.message : err);
    return null;
  }
}

// Stdin wins. The snapshot fills in what it lacks (the 7-day window for clients that only
// send five_hour, model-scoped windows, a balance label), or stands in when stdin has none.
export function resolveUsage(config: HudConfig, stdinUsage: UsageData | null, snapshotText: unknown, now = Date.now()): UsageData | null {
  if (!config.display.externalUsagePath) {
    return stdinUsage;
  }
  const external = getUsageFromExternalSnapshot(snapshotText, config, now);
  if (!stdinUsage || !external) {
    return stdinUsage ?? external;
  }
  return {
    ...stdinUsage,
    ...(external.balanceLabel != null && { balanceLabel: external.balanceLabel }),
    ...(stdinUsage.sevenDay == null && external.sevenDay != null && {
      sevenDay: external.sevenDay,
      sevenDayResetAt: external.sevenDayResetAt ?? null,
    }),
    ...(external.scopedWindows && { scopedWindows: external.scopedWindows }),
  };
}
