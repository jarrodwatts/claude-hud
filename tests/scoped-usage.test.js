import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getUsageFromStdin } from '../dist/stdin.js';

// Model-scoped weekly windows (rate_limits.model_scoped) — additive stdin field.
// Upstream schema: { display_name, utilization (0-1 fraction), resets_at (ISO-8601) }.

function stdinWith(rateLimits) {
  return { rate_limits: rateLimits };
}

test('getUsageFromStdin maps model_scoped entries to scopedWindows (fraction → percent)', () => {
  const usage = getUsageFromStdin(stdinWith({
    five_hour: { used_percentage: 33, resets_at: 1784115000 },
    seven_day: { used_percentage: 21, resets_at: 1784613600 },
    model_scoped: [
      { display_name: 'Fable', utilization: 0.38, resets_at: '2026-07-21T06:00:00.000Z' },
    ],
  }));

  assert.equal(usage.fiveHour, 33);
  assert.equal(usage.scopedWindows.length, 1);
  assert.equal(usage.scopedWindows[0].label, 'Fable');
  assert.equal(usage.scopedWindows[0].percent, 38);
  assert.equal(usage.scopedWindows[0].resetAt.toISOString(), '2026-07-21T06:00:00.000Z');
});

test('getUsageFromStdin omits scopedWindows when model_scoped is absent', () => {
  const usage = getUsageFromStdin(stdinWith({
    five_hour: { used_percentage: 33, resets_at: null },
  }));

  assert.equal(usage.scopedWindows, undefined);
});

test('getUsageFromStdin returns usage when only model_scoped is present', () => {
  const usage = getUsageFromStdin(stdinWith({
    model_scoped: [{ display_name: 'Fable', utilization: 0.5, resets_at: null }],
  }));

  assert.notEqual(usage, null);
  assert.equal(usage.fiveHour, null);
  assert.equal(usage.scopedWindows[0].percent, 50);
  assert.equal(usage.scopedWindows[0].resetAt, null);
});

test('getUsageFromStdin drops malformed model_scoped entries', () => {
  const usage = getUsageFromStdin(stdinWith({
    five_hour: { used_percentage: 10, resets_at: null },
    model_scoped: [
      { display_name: '', utilization: 0.5 }, // empty label
      { display_name: 'Fable', utilization: null }, // no utilization
      { display_name: 'Fable', utilization: 'x' }, // non-numeric
      { display_name: 'Sonnet', utilization: 0.2, resets_at: 'not-a-date' }, // bad date → null resetAt
      null,
    ],
  }));

  assert.equal(usage.scopedWindows.length, 1);
  assert.equal(usage.scopedWindows[0].label, 'Sonnet');
  assert.equal(usage.scopedWindows[0].resetAt, null);
});

test('getUsageFromStdin clamps utilization into 0-100 percent', () => {
  const usage = getUsageFromStdin(stdinWith({
    model_scoped: [
      { display_name: 'Over', utilization: 1.4 },
      { display_name: 'Under', utilization: -0.1 },
    ],
  }));

  assert.equal(usage.scopedWindows[0].percent, 100);
  assert.equal(usage.scopedWindows[1].percent, 0);
});

test('getUsageFromStdin sanitizes display_name (no ANSI smuggling into the terminal)', () => {
  const usage = getUsageFromStdin(stdinWith({
    model_scoped: [{ display_name: '[31mFable[0m', utilization: 0.3 }],
  }));

  assert.equal(usage.scopedWindows[0].label, 'Fable');
});

test('getUsageFromStdin tolerates a non-array model_scoped', () => {
  const usage = getUsageFromStdin(stdinWith({
    five_hour: { used_percentage: 10, resets_at: null },
    model_scoped: 'nope',
  }));

  assert.equal(usage.scopedWindows, undefined);
});
