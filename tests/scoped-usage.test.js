import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderUsageLine } from '../dist/render/lines/usage.js';
import { renderSessionLine } from '../dist/render/session-line.js';

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

// display.showModelScopedUsage — render-time gate for model_scoped windows.

test('renderUsageLine keeps scoped windows alongside 5h/7d by default', () => {
  const line = stripAnsi(renderUsageLine(renderContext(scopedUsage({ fiveHour: 25, sevenDay: 85 }))) ?? '');

  assert.match(line, /5h 25%/);
  assert.match(line, /Weekly 85%/);
  assert.match(line, /Fable 38%/);
});

test('renderUsageLine hides scoped windows when showModelScopedUsage is false', () => {
  const ctx = renderContext(scopedUsage({ fiveHour: 25, sevenDay: 85 }), { showModelScopedUsage: false });
  const line = stripAnsi(renderUsageLine(ctx) ?? '');

  assert.match(line, /5h 25%/);
  assert.match(line, /Weekly 85%/);
  assert.doesNotMatch(line, /Fable/);
});

test('renderUsageLine drops the usage line when only hidden scoped windows exist', () => {
  const ctx = renderContext(scopedUsage(), { showModelScopedUsage: false });

  assert.equal(renderUsageLine(ctx), null);
});

test('renderUsageLine keeps the balance when scoped windows are hidden', () => {
  const ctx = renderContext(scopedUsage({ balanceLabel: '$12 left' }), { showModelScopedUsage: false });
  const line = stripAnsi(renderUsageLine(ctx) ?? '');

  assert.match(line, /Usage\s+\$12 left/);
  assert.doesNotMatch(line, /Fable/);
});

test('renderSessionLine hides scoped windows when showModelScopedUsage is false', () => {
  const ctx = renderContext(scopedUsage({ fiveHour: 25 }), { showModelScopedUsage: false });
  const line = stripAnsi(renderSessionLine(ctx));

  assert.match(line, /5h 25%/);
  assert.doesNotMatch(line, /Fable/);
});

test('renderSessionLine drops the usage segment when only hidden scoped windows exist', () => {
  const ctx = renderContext(scopedUsage(), { showModelScopedUsage: false });
  const line = stripAnsi(renderSessionLine(ctx));

  assert.doesNotMatch(line, /Fable/);
  assert.doesNotMatch(line, /Usage/);
  assert.doesNotMatch(line, /5h/);
});

test('showModelScopedUsage=false stays inert when model_scoped is present but empty', () => {
  // An explicit empty model_scoped array has nothing to hide, so the flag must
  // not change either layout: hiding "no windows" is not the same as hiding
  // windows, and the two must not diverge.
  const empty = scopedUsage({ scopedWindows: [] });
  const shown = renderContext(empty);
  const hidden = renderContext(empty, { showModelScopedUsage: false });

  assert.equal(renderUsageLine(hidden), renderUsageLine(shown));
  assert.equal(renderSessionLine(hidden), renderSessionLine(shown));
});

test('hidden scoped windows no longer lift the usage line over usageThreshold', () => {
  // The gate runs before effectiveUsage is computed, so a hidden window stops
  // holding the line open: with only the scoped window above the threshold,
  // the whole usage group goes away, 5h included, exactly as it would for a
  // payload that never carried scoped windows.
  const usage = scopedUsage({
    fiveHour: 42,
    scopedWindows: [{ label: 'Fable', percent: 100, resetAt: null }],
  });
  const shown = renderContext(usage, { usageThreshold: 80 });
  const hidden = renderContext(usage, { usageThreshold: 80, showModelScopedUsage: false });

  assert.match(stripAnsi(renderUsageLine(shown) ?? ''), /5h 42%/);
  assert.equal(renderUsageLine(hidden), null);
  assert.doesNotMatch(stripAnsi(renderSessionLine(hidden)), /5h|Fable/);
});

test('shared limit warnings retain bounded scoped usage in both layouts', () => {
  const usage = scopedUsage({ fiveHour: 100 });
  const ctx = renderContext(usage);

  const expanded = stripAnsi(renderUsageLine(ctx) ?? '');
  const compactLayout = stripAnsi(renderSessionLine(ctx));
  assert.match(expanded, /Limit reached.*Fable 38%/);
  assert.match(compactLayout, /Limit reached.*Fable 38%/);
});
