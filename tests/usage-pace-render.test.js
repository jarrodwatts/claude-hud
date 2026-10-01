import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderUsageLine } from '../dist/render/lines/usage.js';
import { renderSessionLine } from '../dist/render/session-line.js';

// display.usagePace: colour usage windows by projected usage at reset and mark
// amber/red pace with ▲. Covered through both renderers: renderUsageLine
// (expanded layout) and renderSessionLine (compact layout), which each render
// the usage windows independently.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const RED = '\x1b[31m';
const BRIGHT_MAGENTA = '\x1b[95m';
const BRIGHT_BLUE = '\x1b[94m';

const RENDERERS = [
  ['renderUsageLine', renderUsageLine],
  ['renderSessionLine', renderSessionLine],
];

function stripAnsi(value) {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\x1b\[[0-9;]*m/g, '');
}

// Reset times measured from real "now": the renderers read Date.now().
function resetIn(ms) {
  return new Date(Date.now() + ms);
}
const fiveHourHalfway = () => resetIn(2.5 * HOUR);
const sevenDayHalfway = () => resetIn(3.5 * DAY);

function usage(overrides = {}) {
  return {
    fiveHour: null,
    sevenDay: null,
    fiveHourResetAt: null,
    sevenDayResetAt: null,
    balanceLabel: null,
    ...overrides,
  };
}

function renderContext(usageData, display = {}) {
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
      },
    },
  };
}

function render(fn, usageData, display) {
  return fn(renderContext(usageData, display)) ?? '';
}

for (const [name, fn] of RENDERERS) {
  test(`${name}: pace is off by default — no marker, usage-based colour`, () => {
    const line = render(fn, usage({ fiveHour: 70, fiveHourResetAt: fiveHourHalfway() }));
    assert.ok(line.includes(`${BRIGHT_BLUE}70%`), line);
    assert.doesNotMatch(stripAnsi(line), /▲/);
  });

  test(`${name}: red pace recolours the percent and adds a red marker`, () => {
    // 70% used halfway through projects 140%.
    const line = render(fn, usage({ fiveHour: 70, fiveHourResetAt: fiveHourHalfway() }), { usagePace: true });
    assert.ok(line.includes(`${RED}70%`), line);
    assert.ok(line.includes(`${RED}▲`), line);
    assert.match(stripAnsi(line), /70% ▲/);
  });

  test(`${name}: amber pace uses the usageWarning colour`, () => {
    // 46% used halfway through projects 92%.
    const line = render(fn, usage({ fiveHour: 46, fiveHourResetAt: fiveHourHalfway() }), { usagePace: true });
    assert.ok(line.includes(`${BRIGHT_MAGENTA}46%`), line);
    assert.ok(line.includes(`${BRIGHT_MAGENTA}▲`), line);
  });

  test(`${name}: normal pace renders exactly as with pace off`, () => {
    // 30% used halfway through projects 60%.
    const resetAt = fiveHourHalfway();
    const on = render(fn, usage({ fiveHour: 30, fiveHourResetAt: resetAt }), { usagePace: true });
    const off = render(fn, usage({ fiveHour: 30, fiveHourResetAt: resetAt }));
    assert.equal(on, off);
  });

  test(`${name}: the more severe of usage colour and pace colour wins`, () => {
    // 80% used with 15 minutes left projects ~84%: normal pace, but 80% is
    // already in the usageWarning band on its own.
    const line = render(fn, usage({ fiveHour: 80, fiveHourResetAt: resetIn(15 * 60 * 1000) }), { usagePace: true });
    assert.ok(line.includes(`${BRIGHT_MAGENTA}80%`), line);
    assert.doesNotMatch(stripAnsi(line), /▲/);
  });

  test(`${name}: red pace colours the usage bar`, () => {
    const line = render(
      fn,
      usage({ fiveHour: 70, fiveHourResetAt: fiveHourHalfway() }),
      { usagePace: true, usageBarEnabled: true },
    );
    assert.ok(line.includes(`${RED}█`), line);
    assert.match(stripAnsi(line), /70% ▲/);
  });

  test(`${name}: amber weekly pace shows the weekly window below sevenDayThreshold`, () => {
    // Weekly 50% halfway through the week projects 100%: amber.
    const data = () => usage({
      fiveHour: 10,
      fiveHourResetAt: fiveHourHalfway(),
      sevenDay: 50,
      sevenDayResetAt: sevenDayHalfway(),
    });
    assert.match(stripAnsi(render(fn, data(), { usagePace: true })), /Weekly.*50% ▲/);
    assert.doesNotMatch(stripAnsi(render(fn, data())), /50%/);
  });

  test(`${name}: normal weekly pace keeps the weekly window hidden below sevenDayThreshold`, () => {
    // Weekly 30% halfway through the week projects 60%.
    const line = render(fn, usage({
      fiveHour: 10,
      fiveHourResetAt: fiveHourHalfway(),
      sevenDay: 30,
      sevenDayResetAt: sevenDayHalfway(),
    }), { usagePace: true });
    assert.doesNotMatch(stripAnsi(line), /Weekly|30%/);
  });

  test(`${name}: pace alert overrides usageThreshold`, () => {
    // 60% used halfway through projects 120%, below a usageThreshold of 80.
    const data = () => usage({ fiveHour: 60, fiveHourResetAt: fiveHourHalfway() });
    assert.match(stripAnsi(render(fn, data(), { usagePace: true, usageThreshold: 80 })), /60% ▲/);
    assert.doesNotMatch(stripAnsi(render(fn, data(), { usageThreshold: 80 })), /60%/);
  });

  test(`${name}: weekly pace alert alone overrides usageThreshold`, () => {
    const line = render(fn, usage({
      fiveHour: 10,
      fiveHourResetAt: fiveHourHalfway(),
      sevenDay: 60,
      sevenDayResetAt: sevenDayHalfway(),
    }), { usagePace: true, usageThreshold: 80 });
    assert.match(stripAnsi(line), /Weekly.*60% ▲/);
  });

  test(`${name}: normal pace does not override usageThreshold`, () => {
    // 20% used halfway through projects 40%.
    const line = render(fn, usage({ fiveHour: 20, fiveHourResetAt: fiveHourHalfway() }), { usagePace: true, usageThreshold: 80 });
    assert.doesNotMatch(stripAnsi(line), /20%/);
  });

  test(`${name}: model-scoped weekly windows get pace too`, () => {
    const line = render(fn, usage({
      scopedWindows: [{ label: 'Fable', percent: 60, resetAt: sevenDayHalfway() }],
    }), { usagePace: true });
    assert.match(stripAnsi(line), /Fable.*60% ▲/);
    assert.ok(line.includes(`${RED}60%`), line);
  });

  test(`${name}: weekly-only data gets pace`, () => {
    const line = render(fn, usage({ sevenDay: 60, sevenDayResetAt: sevenDayHalfway() }), { usagePace: true });
    assert.match(stripAnsi(line), /Weekly.*60% ▲/);
  });

  test(`${name}: compact usage shows the marker on 5h and a surfaced 7d window`, () => {
    const line = render(fn, usage({
      fiveHour: 70,
      fiveHourResetAt: fiveHourHalfway(),
      sevenDay: 50,
      sevenDayResetAt: sevenDayHalfway(),
    }), { usagePace: true, usageCompact: true });
    assert.match(stripAnsi(line), /5h: 70% ▲/);
    assert.match(stripAnsi(line), /7d: 50% ▲/);
  });

  test(`${name}: remaining mode is paced on used, not remaining`, () => {
    // 70% used = 30% remaining; pace is still red.
    const line = render(fn, usage({ fiveHour: 70, fiveHourResetAt: fiveHourHalfway() }), { usagePace: true, usageValue: 'remaining' });
    assert.ok(line.includes(`${RED}30%`), line);
    assert.match(stripAnsi(line), /30% ▲/);
  });

  test(`${name}: limit reached shows no pace marker`, () => {
    const line = render(fn, usage({ fiveHour: 100, fiveHourResetAt: resetIn(HOUR) }), { usagePace: true });
    assert.doesNotMatch(stripAnsi(line), /▲/);
  });
}
