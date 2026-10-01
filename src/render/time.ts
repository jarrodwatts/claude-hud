import type { HourCycleMode, HudConfig, TimeFormatMode } from '../config.js';
import type { MessageKey } from '../i18n/types.js';
import { interpolate, t } from '../i18n/index.js';

interface WallClockOptions {
  hourCycle: HourCycleMode;
  showSeconds: boolean;
}

export function wallClock(display: Partial<HudConfig['display']> | undefined): WallClockOptions {
  return { hourCycle: display?.hourCycle ?? 'auto', showSeconds: display?.showClockSeconds ?? false };
}

function formatDuration(ms: number): string {
  const totalMins = Math.ceil(ms / 60000);
  if (totalMins < 60) return `${totalMins}m`;
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return hours % 24 > 0 ? `${days}d ${hours % 24}h` : `${days}d`;
  }
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/** Wall-clock time such as `at 14:30`, with the date when it isn't today. */
export function formatAbsoluteTime(
  at: Date,
  now: Date,
  opts: WallClockOptions,
  pattern: MessageKey = 'format.absoluteTime',
): string {
  const timeOpts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  if (opts.showSeconds) timeOpts.second = '2-digit';
  if (opts.hourCycle !== 'auto') timeOpts.hourCycle = opts.hourCycle;
  const time = at.toLocaleTimeString([], timeOpts);
  const sameDay = at.toDateString() === now.toDateString();
  const value = sameDay ? time : `${at.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
  return interpolate(t(pattern), { time: value });
}

/** `2h 30m`, `at 14:30`, or both. Empty when the reset is unknown or already past. */
export function formatResetTime(
  resetAt: Date | null,
  mode: 'relative' | 'absolute' | 'both',
  opts: WallClockOptions,
  now: number,
): string {
  if (!resetAt) return '';
  const remainingMs = resetAt.getTime() - now;
  if (remainingMs <= 0) return '';
  if (mode === 'relative') return formatDuration(remainingMs);
  const absolute = formatAbsoluteTime(resetAt, new Date(now), opts);
  return mode === 'absolute' ? absolute : `${formatDuration(remainingMs)}, ${absolute}`;
}

function formatElapsed(resetAt: Date | null, windowMs: number, now: number): string {
  if (!resetAt) return '';
  const elapsed = Math.round(((now - (resetAt.getTime() - windowMs)) / windowMs) * 100);
  return interpolate(t('format.elapsed'), { value: Math.max(0, Math.min(100, elapsed)) });
}

/** A usage window's time in the configured format, including the elapsed-share modes. */
export function formatWindowTime(
  resetAt: Date | null,
  windowMs: number,
  timeFormat: TimeFormatMode,
  opts: WallClockOptions,
  now: number,
): string {
  if (timeFormat === 'elapsed') return formatElapsed(resetAt, windowMs, now);
  if (timeFormat === 'elapsedAndAbsolute') {
    const elapsed = formatElapsed(resetAt, windowMs, now);
    const absolute = formatResetTime(resetAt, 'absolute', opts, now);
    return elapsed && absolute ? `${elapsed}, ${absolute}` : elapsed || absolute;
  }
  return formatResetTime(resetAt, timeFormat, opts, now);
}

/** The reset format for a limit-reached notice, which has no elapsed share to show. */
export function limitTimeFormat(timeFormat: TimeFormatMode): 'relative' | 'absolute' | 'both' {
  if (timeFormat === 'elapsedAndAbsolute') return 'absolute';
  if (timeFormat === 'elapsed') return 'relative';
  return timeFormat;
}

/** `45s ago`, `2h 5m ago`, `3d 4h ago`. */
export function formatAgo(ms: number): string {
  if (ms < 0) return t('format.justNow');
  const ago = (value: string): string => interpolate(t('format.relativeTime'), { value });
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return ago(`${seconds}s`);
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return ago(`${minutes}m`);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return ago(minutes % 60 > 0 ? `${hours}h ${minutes % 60}m` : `${hours}h`);
  const days = Math.floor(hours / 24);
  return ago(hours % 24 > 0 ? `${days}d ${hours % 24}h` : `${days}d`);
}
