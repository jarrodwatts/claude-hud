import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatResetTime } from '../dist/render/format-reset-time.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a Date that is `ms` milliseconds in the future. */
function future(ms) {
  return new Date(Date.now() + ms);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------------------
// Null / past guard
// ---------------------------------------------------------------------------

test('returns empty string for null', () => {
  assert.equal(formatResetTime(null), '');
  assert.equal(formatResetTime(null, 'absolute'), '');
  assert.equal(formatResetTime(null, 'both'), '');
});

test('returns empty string for a date in the past', () => {
  const past = new Date(Date.now() - HOUR);
  assert.equal(formatResetTime(past), '');
  assert.equal(formatResetTime(past, 'absolute'), '');
  assert.equal(formatResetTime(past, 'both'), '');
});

// ---------------------------------------------------------------------------
// relative mode (default)
// ---------------------------------------------------------------------------

test('relative: shows minutes when < 1 hour', () => {
  const result = formatResetTime(future(30 * MINUTE));
  assert.match(result, /^\d+m$/);
});

test('relative: shows hours + minutes when < 24 hours', () => {
  const result = formatResetTime(future(2 * HOUR + 30 * MINUTE));
  assert.match(result, /^2h 30m$/);
});

test('relative: shows hours only when minutes == 0', () => {
  // Exactly N hours: Math.ceil(N*60 mins) = N*60 → mins % 60 === 0
  const result = formatResetTime(future(3 * HOUR));
  assert.match(result, /^3h$/);
});

test('relative: shows days + hours for durations >= 24 hours', () => {
  const result = formatResetTime(future(6 * DAY + 7 * HOUR));
  assert.match(result, /^6d 7h$/);
});

test('relative: shows days only when remaining hours == 0', () => {
  // Exactly N days → hours % 24 === 0
  const result = formatResetTime(future(3 * DAY));
  assert.match(result, /^3d$/);
});

test('relative: is the default when mode is omitted', () => {
  const withDefault = formatResetTime(future(90 * MINUTE));
  const withExplicit = formatResetTime(future(90 * MINUTE), 'relative');
  // Both should match the same pattern (values may differ by a few ms)
  assert.match(withDefault, /^\d+h( \d+m)?$/);
  assert.match(withExplicit, /^\d+h( \d+m)?$/);
});

// ---------------------------------------------------------------------------
// absolute mode
// ---------------------------------------------------------------------------

test('absolute: starts with "at " prefix', () => {
  const result = formatResetTime(future(2 * HOUR), 'absolute');
  assert.ok(result.startsWith('at '), `Expected "at " prefix, got: ${result}`);
});

test('absolute: returns a non-empty string for a future date', () => {
  const result = formatResetTime(future(2 * HOUR), 'absolute');
  assert.ok(result.length > 3, `Expected a non-trivial absolute string, got: ${result}`);
});

test('absolute: includes date component when reset is tomorrow or later', () => {
  const resetAt = future(30 * HOUR); // guaranteed to be a different calendar day
  const result = formatResetTime(resetAt, 'absolute');
  const expectedDate = resetAt.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  });
  const expectedTime = resetAt.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  assert.ok(result.startsWith('at '), `Expected "at " prefix, got: ${result}`);
  assert.ok(result.includes(expectedDate), `Expected localized date in next-day reset, got: ${result}`);
  assert.ok(result.endsWith(expectedTime), `Expected localized time in next-day reset, got: ${result}`);
});

// ---------------------------------------------------------------------------
// both mode
// ---------------------------------------------------------------------------

test('both: contains the relative duration', () => {
  const result = formatResetTime(future(2 * HOUR + 30 * MINUTE), 'both');
  assert.match(result, /2h 30m/);
});

test('both: contains the absolute "at" part after a comma', () => {
  const result = formatResetTime(future(2 * HOUR), 'both');
  assert.match(result, /, at .+/);
});

test('both: format is "<relative>, <absolute>"', () => {
  const result = formatResetTime(future(2 * HOUR), 'both');
  // e.g. "2h, at 14:30" — comma avoids nested parens when caller wraps in (...)
  assert.match(result, /^\d+h( \d+m)?, at .+$/);
});

// ---------------------------------------------------------------------------
// hourCycle / showSeconds opts
// ---------------------------------------------------------------------------

test('opts: default (auto) matches the pre-existing locale-driven output', () => {
  const resetAt = future(2 * HOUR);
  const withoutOpts = formatResetTime(resetAt, 'absolute');
  const withAutoOpts = formatResetTime(resetAt, 'absolute', { hourCycle: 'auto', showSeconds: false });
  assert.equal(withoutOpts, withAutoOpts);
});

// A reset two hours out lands on the next calendar day whenever these run
// between 22:00 and midnight local time, and the formatter then prefixes a
// localized date. That prefix is correct and is covered by its own test above,
// so these assert the clock component rather than the whole string.

test('opts: h23 avoids AM/PM and uses 00-23 hours', () => {
  const resetAt = future(2 * HOUR);
  const result = formatResetTime(resetAt, 'absolute', { hourCycle: 'h23', showSeconds: false });
  assert.doesNotMatch(result, /AM|PM/i);
  assert.ok(result.startsWith('at '), `Expected "at " prefix, got: ${result}`);
  assert.match(result, /\d{2}:\d{2}$/);
});

test('opts: showSeconds adds a seconds component', () => {
  const resetAt = future(2 * HOUR);
  const result = formatResetTime(resetAt, 'absolute', { hourCycle: 'h23', showSeconds: true });
  assert.ok(result.startsWith('at '), `Expected "at " prefix, got: ${result}`);
  assert.match(result, /\d{2}:\d{2}:\d{2}$/);
});

test('opts: midnight boundary — h23 shows 00, not 24', () => {
  const resetAt = new Date();
  resetAt.setDate(resetAt.getDate() + 1);
  resetAt.setHours(0, 5, 0, 0);
  const result = formatResetTime(resetAt, 'absolute', { hourCycle: 'h23', showSeconds: false });
  assert.match(result, /00:05$/);
});

test('opts: midnight boundary — h24 shows 24, not 00', () => {
  const resetAt = new Date();
  resetAt.setDate(resetAt.getDate() + 1);
  resetAt.setHours(0, 5, 0, 0);
  const result = formatResetTime(resetAt, 'absolute', { hourCycle: 'h24', showSeconds: false });
  assert.match(result, /24:05$/);
});

// ---------------------------------------------------------------------------
// config integration — mergeConfig accepts and validates timeFormat
// ---------------------------------------------------------------------------

test('mergeConfig defaults timeFormat to "relative"', async () => {
  const { mergeConfig } = await import('../dist/config.js');
  const config = mergeConfig({});
  assert.equal(config.display.timeFormat, 'relative');
});

test('mergeConfig accepts "absolute" timeFormat', async () => {
  const { mergeConfig } = await import('../dist/config.js');
  const config = mergeConfig({ display: { timeFormat: 'absolute' } });
  assert.equal(config.display.timeFormat, 'absolute');
});

test('mergeConfig accepts "both" timeFormat', async () => {
  const { mergeConfig } = await import('../dist/config.js');
  const config = mergeConfig({ display: { timeFormat: 'both' } });
  assert.equal(config.display.timeFormat, 'both');
});

test('mergeConfig rejects invalid timeFormat and falls back to "relative"', async () => {
  const { mergeConfig } = await import('../dist/config.js');
  const config = mergeConfig({ display: { timeFormat: 'invalid-value' } });
  assert.equal(config.display.timeFormat, 'relative');
});

// ---------------------------------------------------------------------------
// config integration — mergeConfig accepts and validates hourCycle / showClockSeconds
// ---------------------------------------------------------------------------

test('mergeConfig defaults hourCycle to "auto"', async () => {
  const { mergeConfig } = await import('../dist/config.js');
  const config = mergeConfig({});
  assert.equal(config.display.hourCycle, 'auto');
});

test('mergeConfig accepts a valid hourCycle', async () => {
  const { mergeConfig } = await import('../dist/config.js');
  const config = mergeConfig({ display: { hourCycle: 'h23' } });
  assert.equal(config.display.hourCycle, 'h23');
});

test('mergeConfig rejects invalid hourCycle and falls back to "auto"', async () => {
  const { mergeConfig } = await import('../dist/config.js');
  const config = mergeConfig({ display: { hourCycle: 'not-a-cycle' } });
  assert.equal(config.display.hourCycle, 'auto');
});

test('mergeConfig defaults showClockSeconds to false', async () => {
  const { mergeConfig } = await import('../dist/config.js');
  const config = mergeConfig({});
  assert.equal(config.display.showClockSeconds, false);
});

test('mergeConfig accepts showClockSeconds true', async () => {
  const { mergeConfig } = await import('../dist/config.js');
  const config = mergeConfig({ display: { showClockSeconds: true } });
  assert.equal(config.display.showClockSeconds, true);
});
