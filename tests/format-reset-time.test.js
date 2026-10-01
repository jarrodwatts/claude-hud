import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAgo, formatResetTime, formatWindowTime, limitTimeFormat } from '../dist/render/time.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = new Date(2026, 9, 1, 12, 0).getTime();
const AUTO = { hourCycle: 'auto', showSeconds: false };
const H23 = { hourCycle: 'h23', showSeconds: false };
const at = (ms) => new Date(NOW + ms);
const relative = (ms) => formatResetTime(at(ms), 'relative', AUTO, NOW);

test('formatResetTime is empty for an unknown or past reset', () => {
  for (const mode of ['relative', 'absolute', 'both']) {
    assert.equal(formatResetTime(null, mode, AUTO, NOW), '');
    assert.equal(formatResetTime(at(-HOUR), mode, AUTO, NOW), '');
    assert.equal(formatResetTime(at(0), mode, AUTO, NOW), '');
  }
});

test('relative rounds up to the minute and drops zero units', () => {
  assert.equal(relative(1), '1m');
  assert.equal(relative(30 * MINUTE), '30m');
  assert.equal(relative(59 * MINUTE + 1), '1h');
  assert.equal(relative(2 * HOUR + 30 * MINUTE), '2h 30m');
  assert.equal(relative(3 * HOUR), '3h');
  assert.equal(relative(6 * DAY + 7 * HOUR), '6d 7h');
  assert.equal(relative(3 * DAY), '3d');
});

test('absolute shows the clock today and adds the date on another day', () => {
  assert.equal(formatResetTime(at(2 * HOUR + 30 * MINUTE), 'absolute', H23, NOW), 'at 14:30');
  const tomorrow = at(30 * HOUR);
  const date = tomorrow.toLocaleDateString([], { month: 'short', day: 'numeric' });
  assert.equal(formatResetTime(tomorrow, 'absolute', H23, NOW), `at ${date} 18:00`);
  const auto = at(2 * HOUR).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  assert.equal(formatResetTime(at(2 * HOUR), 'absolute', AUTO, NOW), `at ${auto}`);
});

test('both joins relative and absolute with a comma', () => {
  assert.equal(formatResetTime(at(2 * HOUR), 'both', H23, NOW), '2h, at 14:00');
});

test('hour cycle and seconds options shape the clock', () => {
  const midnight = new Date(2026, 9, 2, 0, 5).getTime();
  const nearMidnight = midnight - MINUTE;
  assert.match(formatResetTime(new Date(midnight), 'absolute', H23, nearMidnight), /00:05$/);
  assert.match(formatResetTime(new Date(midnight), 'absolute', { hourCycle: 'h24', showSeconds: false }, nearMidnight), /24:05$/);
  assert.equal(formatResetTime(at(HOUR + 5_000), 'absolute', { hourCycle: 'h23', showSeconds: true }, NOW), 'at 13:00:05');
});

test('formatWindowTime shows the elapsed share of the window, clamped', () => {
  const window = 5 * HOUR;
  assert.equal(formatWindowTime(at(90 * MINUTE), window, 'elapsed', H23, NOW), '70% elapsed');
  assert.equal(formatWindowTime(at(10 * HOUR), window, 'elapsed', H23, NOW), '0% elapsed');
  assert.equal(formatWindowTime(at(-HOUR), window, 'elapsed', H23, NOW), '100% elapsed');
  assert.equal(formatWindowTime(null, window, 'elapsed', H23, NOW), '');
  assert.equal(formatWindowTime(at(90 * MINUTE), window, 'elapsedAndAbsolute', H23, NOW), '70% elapsed, at 13:30');
  assert.equal(formatWindowTime(at(90 * MINUTE), window, 'both', H23, NOW), '1h 30m, at 13:30');
});

test('limitTimeFormat maps elapsed modes to a reset format', () => {
  assert.equal(limitTimeFormat('elapsed'), 'relative');
  assert.equal(limitTimeFormat('elapsedAndAbsolute'), 'absolute');
  assert.equal(limitTimeFormat('both'), 'both');
});

test('formatAgo', () => {
  assert.equal(formatAgo(-1), 'just now');
  assert.equal(formatAgo(45_000), '45s ago');
  assert.equal(formatAgo(5 * MINUTE), '5m ago');
  assert.equal(formatAgo(2 * HOUR + 5 * MINUTE), '2h 5m ago');
  assert.equal(formatAgo(3 * HOUR), '3h ago');
  assert.equal(formatAgo(3 * DAY + 4 * HOUR), '3d 4h ago');
});
