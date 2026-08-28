import type { HourCycleMode, TimeFormatMode } from '../config.js';
import type { MessageKey } from '../i18n/types.js';
import { interpolate, t } from '../i18n/index.js';

/** Options controlling how wall-clock time is rendered. */
export interface WallClockOptions {
  hourCycle: HourCycleMode;
  showSeconds: boolean;
}

const DEFAULT_WALL_CLOCK_OPTIONS: WallClockOptions = { hourCycle: 'auto', showSeconds: false };

/**
 * Formats a usage-window reset timestamp for display in the HUD.
 *
 * @param resetAt - The reset timestamp, or null if unknown.
 * @param mode    - How to express the time:
 *   - `'relative'` (default) — duration until reset, e.g. `2h 30m`
 *   - `'absolute'`           — wall-clock time,       e.g. `at 14:30` (locale-aware)
 *   - `'both'`               — both combined,          e.g. `2h 30m, at 14:30` (locale-aware)
 * @param opts    - Wall-clock rendering options (hourCycle, showSeconds); defaults preserve existing behavior.
 * @returns A formatted string, or an empty string when the reset is in the past
 *          or the date is unknown.
 */
export function formatResetTime(
  resetAt: Date | null,
  mode: TimeFormatMode = 'relative',
  opts: WallClockOptions = DEFAULT_WALL_CLOCK_OPTIONS,
): string {
  if (!resetAt) return '';

  const now = new Date();
  const diffMs = resetAt.getTime() - now.getTime();
  if (diffMs <= 0) return '';

  if (mode === 'relative') {
    return formatRelative(diffMs);
  }

  const absolute = formatAbsoluteTime(resetAt, now, opts);

  if (mode === 'absolute') {
    return absolute;
  }

  // 'both' — comma separator avoids nested parentheses when the caller
  // wraps the result in its own (...) parenthetical
  return `${formatRelative(diffMs)}, ${absolute}`;
}

function formatRelative(diffMs: number): string {
  const diffMins = Math.ceil(diffMs / 60000);

  if (diffMins < 60) {
    return `${diffMins}m`;
  }

  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
  }

  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/**
 * Renders a timestamp as wall-clock time, e.g. `at 14:30`, adding a date
 * component when it falls on a different calendar day than `now`.
 *
 * @param at   - The timestamp to render.
 * @param now  - Reference for the same-day check.
 * @param opts - Wall-clock rendering options (hourCycle, showSeconds).
 */
export function formatAbsoluteTime(
  resetAt: Date,
  now: Date,
  opts: WallClockOptions = DEFAULT_WALL_CLOCK_OPTIONS,
  pattern: MessageKey = 'format.absoluteTime',
): string {
  const timeOpts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  if (opts.showSeconds) timeOpts.second = '2-digit';
  if (opts.hourCycle !== 'auto') timeOpts.hourCycle = opts.hourCycle;
  const timeStr = resetAt.toLocaleTimeString([], timeOpts);

  if (resetAt.toDateString() === now.toDateString()) {
    return interpolate(t(pattern), { time: timeStr });
  }

  const dateStr = resetAt.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return interpolate(t(pattern), { time: `${dateStr} ${timeStr}` });
}
