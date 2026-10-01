import * as fs from 'node:fs';
import * as path from 'node:path';
import type { HudConfig } from './config.js';
import { createDebug } from './debug.js';
import type { ExternalUsageSnapshot, ScopedUsageWindow, UsageData } from './types.js';
import { sanitizeDisplayText } from './utils/sanitize.js';

const debug = createDebug('external-usage');

const MAX_BALANCE_LABEL_LENGTH = 50;
export const EXTERNAL_USAGE_WRITE_THROTTLE_MS = 30_000;

type ExternalUsageWriteSnapshot = {
  updated_at: string;
  five_hour: {
    used_percentage: number | null;
    resets_at: string | null;
  };
  seven_day: {
    used_percentage: number | null;
    resets_at: string | null;
  };
};

type FileSystemDeps = {
  chmodSync: typeof fs.chmodSync;
  readFileSync: typeof fs.readFileSync;
  renameSync: typeof fs.renameSync;
  rmSync: typeof fs.rmSync;
  statSync: typeof fs.statSync;
  writeFileSync: typeof fs.writeFileSync;
};

const fsDeps: FileSystemDeps = {
  chmodSync: fs.chmodSync,
  readFileSync: fs.readFileSync,
  renameSync: fs.renameSync,
  rmSync: fs.rmSync,
  statSync: fs.statSync,
  writeFileSync: fs.writeFileSync,
};

function parseUsagePercent(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.round(Math.min(100, Math.max(0, value)));
}

function sanitizeBalanceLabel(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const sanitized = sanitizeDisplayText(value).trim();

  if (!sanitized) {
    return null;
  }

  if (sanitized.length <= MAX_BALANCE_LABEL_LENGTH) {
    return sanitized;
  }

  return `${sanitized.slice(0, MAX_BALANCE_LABEL_LENGTH - 3)}...`;
}

function parseDateValue(value: unknown): Date | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) {
      return null;
    }
    const millis = value > 1e12 ? value : value * 1000;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === 'string' && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function parseUpdatedAt(value: unknown): number | null {
  const date = parseDateValue(value);
  return date ? date.getTime() : null;
}

function snapshotFromUsage(usage: UsageData, now: number): ExternalUsageWriteSnapshot {
  return {
    updated_at: new Date(now).toISOString(),
    five_hour: {
      used_percentage: usage.fiveHour,
      resets_at: usage.fiveHourResetAt?.toISOString() ?? null,
    },
    seven_day: {
      used_percentage: usage.sevenDay,
      resets_at: usage.sevenDayResetAt?.toISOString() ?? null,
    },
  };
}

// Rewrite when the values change or the snapshot is older than the throttle, so readers
// can trust updated_at without the file being rewritten on every render.
function shouldWriteSnapshot(
  snapshotPath: string,
  nextSnapshot: ExternalUsageWriteSnapshot,
  now: number,
  deps: FileSystemDeps,
): boolean {
  try {
    if (now - deps.statSync(snapshotPath).mtimeMs > EXTERNAL_USAGE_WRITE_THROTTLE_MS) {
      return true;
    }
    const { updated_at: _, ...current } = JSON.parse(deps.readFileSync(snapshotPath, 'utf8') as string);
    const { updated_at: __, ...next } = nextSnapshot;
    return JSON.stringify(current) !== JSON.stringify(next);
  } catch {
    return true;
  }
}

function resolveSnapshotWritePath(snapshotPath: string): string | null {
  if (!path.isAbsolute(snapshotPath)) {
    return null;
  }

  const parsed = path.parse(snapshotPath);
  if (!parsed.base || parsed.ext.toLowerCase() !== '.json') {
    return null;
  }

  return path.normalize(snapshotPath);
}

function directoryExists(dir: string, deps: FileSystemDeps): boolean {
  try {
    return deps.statSync(dir).isDirectory();
  } catch (err) {
    debug('Directory check failed for %s:', dir, err instanceof Error ? err.message : err);
    return false;
  }
}

export function writeExternalUsageSnapshot(
  config: HudConfig,
  usage: UsageData | null,
  now = Date.now(),
  deps: FileSystemDeps = fsDeps,
): boolean {
  const snapshotPath = resolveSnapshotWritePath(config.display.externalUsageWritePath);
  if (
    !snapshotPath
    || !usage
    || (usage.fiveHour === null && usage.sevenDay === null)
  ) {
    return false;
  }

  const snapshot = snapshotFromUsage(usage, now);
  const dir = path.dirname(snapshotPath);
  const base = path.basename(snapshotPath);
  const tmpPath = path.join(
    dir,
    `.${base}.${process.pid}.${now}.${Math.random().toString(36).slice(2)}.tmp`,
  );

  try {
    if (!directoryExists(dir, deps)) {
      return false;
    }

    if (!shouldWriteSnapshot(snapshotPath, snapshot, now, deps)) {
      return false;
    }

    deps.writeFileSync(tmpPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    deps.renameSync(tmpPath, snapshotPath);
    deps.chmodSync(snapshotPath, 0o600);
    return true;
  } catch (err) {
    debug('Failed to write usage snapshot:', err instanceof Error ? err.message : err);
    try {
      deps.rmSync(tmpPath, { force: true });
    } catch (cleanupErr) {
      debug('Failed to clean up temp file:', cleanupErr instanceof Error ? cleanupErr.message : cleanupErr);
    }
    return false;
  }
}

export function getUsageFromExternalSnapshot(
  config: HudConfig,
  now = Date.now(),
): UsageData | null {
  const snapshotPath = config.display.externalUsagePath;
  if (!snapshotPath || !path.isAbsolute(snapshotPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(snapshotPath, 'utf8');
    const parsed = JSON.parse(raw) as ExternalUsageSnapshot;
    const updatedAt = parseUpdatedAt(parsed.updated_at);
    if (updatedAt === null) {
      return null;
    }

    const freshnessMs = config.display.externalUsageFreshnessMs;
    if (now - updatedAt > freshnessMs) {
      return null;
    }

    const fiveHour = parseUsagePercent(parsed.five_hour?.used_percentage);
    const sevenDay = parseUsagePercent(parsed.seven_day?.used_percentage);
    const balanceLabel = sanitizeBalanceLabel(parsed.balance_label);
    const scopedWindows = parseScopedWindows(parsed.model_scoped);
    if (
      fiveHour === null
      && sevenDay === null
      && balanceLabel === null
      && scopedWindows.length === 0
    ) {
      return null;
    }

    const fiveHourResetAt = parseDateValue(parsed.five_hour?.resets_at);
    const sevenDayResetAt = parseDateValue(parsed.seven_day?.resets_at);

    if (parsed.five_hour && parsed.five_hour.resets_at != null && fiveHourResetAt === null) {
      return null;
    }
    if (parsed.seven_day && parsed.seven_day.resets_at != null && sevenDayResetAt === null) {
      return null;
    }

    const usage: UsageData = {
      fiveHour,
      sevenDay,
      fiveHourResetAt,
      sevenDayResetAt,
    };
    if (balanceLabel !== null) {
      usage.balanceLabel = balanceLabel;
    }
    if (scopedWindows.length > 0) {
      usage.scopedWindows = scopedWindows;
    }
    return usage;
  } catch (err) {
    debug('Failed to read external usage snapshot:', err instanceof Error ? err.message : err);
    return null;
  }
}

const SCOPED_WINDOWS_MAX = 8;
const SCOPED_LABEL_MAX_LENGTH = 64;

// model_scoped windows ({ display_name, utilization 0-100, resets_at ISO-8601 }). The
// snapshot is untrusted, so entries are bounded and malformed ones dropped.
function parseScopedWindows(value: unknown): ScopedUsageWindow[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const windows: ScopedUsageWindow[] = [];
  for (const entry of value) {
    if (windows.length >= SCOPED_WINDOWS_MAX) break;
    const label = typeof entry?.display_name === 'string'
      ? sanitizeDisplayText(entry.display_name).trim().slice(0, SCOPED_LABEL_MAX_LENGTH)
      : '';
    const percent = entry?.utilization === null ? null : parseUsagePercent(entry?.utilization);
    if (!label || (entry?.utilization !== null && percent === null)) continue;
    const resetAt = typeof entry?.resets_at === 'string' && !Number.isNaN(Date.parse(entry.resets_at))
      ? new Date(entry.resets_at)
      : null;
    windows.push({ label, percent, resetAt });
  }
  return windows;
}

// Stdin wins. The snapshot fills in what it lacks (the 7-day window for clients that only
// send five_hour, model-scoped windows, a balance label), or stands in when stdin has none.
export function resolveUsage(config: HudConfig, stdinUsage: UsageData | null, now = Date.now()): UsageData | null {
  if (!config.display.externalUsagePath) {
    return stdinUsage;
  }
  const external = getUsageFromExternalSnapshot(config, now);
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
