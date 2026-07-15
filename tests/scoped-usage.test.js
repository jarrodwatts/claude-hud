import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getUsageFromStdin } from '../dist/stdin.js';
import { renderUsageLine } from '../dist/render/lines/usage.js';
import { renderSessionLine } from '../dist/render/session-line.js';

// Model-scoped weekly windows (rate_limits.model_scoped) — additive stdin field.
// Upstream schema: { display_name, utilization (0-100 percent), resets_at (ISO-8601) }.

function stdinWith(rateLimits) {
  return { rate_limits: rateLimits };
}

function stripAnsi(value) {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\x1b\[[0-9;]*m/g, '');
}

function renderContext(usageData, display = {}, colors = {}) {
  return {
    stdin: {
      model: { display_name: 'Opus' },
      context_window: {
        context_window_size: 200000,
        used_percentage: 10,
        current_usage: {
          input_tokens: 20000,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    },
    transcript: { tools: [], skills: [], mcpServers: [], agents: [], todos: [] },
    claudeMdCount: 0,
    rulesCount: 0,
    mcpCount: 0,
    hooksCount: 0,
    sessionDuration: '',
    gitStatus: null,
    usageData,
    memoryUsage: null,
    config: {
      lineLayout: 'compact',
      pathLevels: 1,
      display: {
        showModel: true,
        showProject: false,
        showContextBar: true,
        showUsage: true,
        usageBarEnabled: false,
        showResetLabel: true,
        usageThreshold: 0,
        sevenDayThreshold: 80,
        ...display,
      },
      colors: {
        context: 'green',
        warning: 'yellow',
        usageWarning: 'brightMagenta',
        critical: 'red',
        model: 'cyan',
        label: 'dim',
        ...colors,
      },
    },
  };
}

function scopedUsage(overrides = {}) {
  return {
    fiveHour: null,
    sevenDay: null,
    fiveHourResetAt: null,
    sevenDayResetAt: null,
    scopedWindows: [{ label: 'Fable', percent: 38, resetAt: null }],
    ...overrides,
  };
}

test('getUsageFromStdin maps model_scoped entries on the upstream 0-100 scale', () => {
  const usage = getUsageFromStdin(stdinWith({
    five_hour: { used_percentage: 33, resets_at: 1784115000 },
    seven_day: { used_percentage: 21, resets_at: 1784613600 },
    model_scoped: [
      { display_name: 'Fable', utilization: 38, resets_at: '2026-07-21T06:00:00.000Z' },
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
    model_scoped: [{ display_name: 'Fable', utilization: 50, resets_at: null }],
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
      { display_name: '', utilization: 50 }, // empty label
      { display_name: 'Fable', utilization: null }, // valid unknown utilization
      { display_name: 'Fable', utilization: 'x' }, // non-numeric
      { display_name: 'Sonnet', utilization: 20, resets_at: 'not-a-date' }, // bad date → null resetAt
      null,
    ],
  }));

  assert.equal(usage.scopedWindows.length, 2);
  assert.equal(usage.scopedWindows[0].label, 'Fable');
  assert.equal(usage.scopedWindows[0].percent, null);
  assert.equal(usage.scopedWindows[1].label, 'Sonnet');
  assert.equal(usage.scopedWindows[1].resetAt, null);
});

test('getUsageFromStdin clamps utilization into 0-100 percent', () => {
  const usage = getUsageFromStdin(stdinWith({
    model_scoped: [
      { display_name: 'Over', utilization: 140 },
      { display_name: 'Under', utilization: -10 },
    ],
  }));

  assert.equal(usage.scopedWindows[0].percent, 100);
  assert.equal(usage.scopedWindows[1].percent, 0);
});

test('getUsageFromStdin sanitizes ANSI, OSC 8, controls, and bidi from display_name', () => {
  const usage = getUsageFromStdin(stdinWith({
    model_scoped: [{
      display_name: '\x1b]8;;https://evil.test\x07\x1b[31mFa\n\u202Eble\x1b[0m\x1b]8;;\x07',
      utilization: 30,
    }],
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

test('getUsageFromStdin bounds retained windows, labels, and reset parsing', () => {
  const usage = getUsageFromStdin(stdinWith({
    model_scoped: Array.from({ length: 12 }, (_, index) => ({
      display_name: `${'x'.repeat(100)}${index}`,
      utilization: index,
      resets_at: 'x'.repeat(65),
    })),
  }));

  assert.equal(usage.scopedWindows.length, 8);
  assert.equal(usage.scopedWindows[0].label.length, 64);
  assert.equal(usage.scopedWindows[0].resetAt, null);
});

test('renderUsageLine renders scoped-only usage without a ghost generic window', () => {
  const line = stripAnsi(renderUsageLine(renderContext(scopedUsage())) ?? '');

  assert.match(line, /Usage\s+Fable 38%/);
  assert.doesNotMatch(line, /5h|--/);
});

test('renderUsageLine applies scoped thresholds, remaining mode, and balance', () => {
  const ctx = renderContext(
    scopedUsage({ balanceLabel: '$12 left' }),
    { usageCompact: true, usageValue: 'remaining', usageThreshold: 30 },
  );
  const line = stripAnsi(renderUsageLine(ctx) ?? '');

  assert.match(line, /Fable: 62%/);
  assert.match(line, /\$12 left/);
});

test('renderSessionLine includes scoped usage and preserves a custom usage color', () => {
  const line = renderSessionLine(renderContext(scopedUsage(), {}, { usage: 'cyan' }));

  assert.match(stripAnsi(line), /Usage\s+Fable 38%/);
  assert.match(line, /\x1b\[36m38%\x1b\[0m/);
});

test('shared limit warnings retain bounded scoped usage in both layouts', () => {
  const usage = scopedUsage({ fiveHour: 100 });
  const ctx = renderContext(usage);

  const expanded = stripAnsi(renderUsageLine(ctx) ?? '');
  const compactLayout = stripAnsi(renderSessionLine(ctx));
  assert.match(expanded, /Limit reached.*Fable 38%/);
  assert.match(compactLayout, /Limit reached.*Fable 38%/);
});
