import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getUsagePace } from '../src/usage-pace.ts';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const FIVE_HOURS = 5 * HOUR;
const SEVEN_DAYS = 7 * DAY;
const NOW = Date.UTC(2026, 8, 29, 12, 0, 0);

// Reset time for a window that is `elapsedMs` into its `windowMs` span.
function resetAfter(windowMs, elapsedMs) {
  return new Date(NOW + windowMs - elapsedMs);
}

test('getUsagePace grades the 5h window halfway through by projected end-of-window usage', () => {
  const halfway = resetAfter(FIVE_HOURS, 2.5 * HOUR);
  // Projected = used / 0.5 elapsed.
  assert.equal(getUsagePace(44, halfway, FIVE_HOURS, NOW), 'normal'); // projects 88%
  assert.equal(getUsagePace(45, halfway, FIVE_HOURS, NOW), 'warning'); // projects 90%
  assert.equal(getUsagePace(50, halfway, FIVE_HOURS, NOW), 'warning'); // exactly even pace: 100%
  assert.equal(getUsagePace(51, halfway, FIVE_HOURS, NOW), 'critical'); // projects 102%
});

test('getUsagePace grades the 7d window at the end of day 5', () => {
  const dayFive = resetAfter(SEVEN_DAYS, 5 * DAY);
  // Projected = used * 7 / 5.
  assert.equal(getUsagePace(64, dayFive, SEVEN_DAYS, NOW), 'normal'); // projects 89.6%
  assert.equal(getUsagePace(65, dayFive, SEVEN_DAYS, NOW), 'warning'); // projects 91%
  assert.equal(getUsagePace(72, dayFive, SEVEN_DAYS, NOW), 'critical'); // projects 100.8%
});

test('getUsagePace stays normal below 10% used however early in the window', () => {
  const fiveMinutesIn = resetAfter(FIVE_HOURS, 5 * 60 * 1000);
  // 9% after 5 minutes projects 540%, but that little usage is noise.
  assert.equal(getUsagePace(9, fiveMinutesIn, FIVE_HOURS, NOW), 'normal');
});

test('getUsagePace flags 10% used within the first 30 minutes of a 5h window', () => {
  const thirtyMinutesIn = resetAfter(FIVE_HOURS, 0.5 * HOUR);
  assert.equal(getUsagePace(10, thirtyMinutesIn, FIVE_HOURS, NOW), 'warning'); // projects exactly 100%
  assert.equal(getUsagePace(11, thirtyMinutesIn, FIVE_HOURS, NOW), 'critical');
});

test('getUsagePace returns null when there is nothing to project from', () => {
  const halfway = resetAfter(FIVE_HOURS, 2.5 * HOUR);
  assert.equal(getUsagePace(null, halfway, FIVE_HOURS, NOW), null);
  assert.equal(getUsagePace(60, null, FIVE_HOURS, NOW), null);
  assert.equal(getUsagePace(60, new Date(Number.NaN), FIVE_HOURS, NOW), null);
});

test('getUsagePace returns null for a reset time already in the past', () => {
  assert.equal(getUsagePace(60, new Date(NOW - 1000), FIVE_HOURS, NOW), null);
  assert.equal(getUsagePace(60, new Date(NOW), FIVE_HOURS, NOW), null);
});

test('getUsagePace returns null for a reset time a full window or more away', () => {
  // No time has elapsed (or the reset is beyond one window), so no rate exists.
  assert.equal(getUsagePace(60, new Date(NOW + FIVE_HOURS), FIVE_HOURS, NOW), null);
  assert.equal(getUsagePace(60, new Date(NOW + 2 * FIVE_HOURS), FIVE_HOURS, NOW), null);
});
