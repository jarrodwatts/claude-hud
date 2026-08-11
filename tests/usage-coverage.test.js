import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderUsageLine } from '../dist/render/lines/usage.js';

function stripAnsi(str) {
  return str
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
}

function baseContext() {
  return {
    stdin: {
      model: { display_name: 'Opus' },
      context_window: {
        context_window_size: 200000,
        current_usage: {
          input_tokens: 10000,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    },
    transcript: { tools: [], skills: [], mcpServers: [], agents: [], todos: [], sessionTokens: undefined },
    claudeMdCount: 0,
    rulesCount: 0,
    mcpCount: 0,
    hooksCount: 0,
    sessionDuration: '',
    gitStatus: null,
    usageData: {
      fiveHour: 25,
      sevenDay: null,
      fiveHourResetAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
      sevenDayResetAt: null,
      balanceLabel: null,
    },
    memoryUsage: null,
    config: {
      lineLayout: 'compact',
      showSeparators: false,
      pathLevels: 1,
      elementOrder: ['project', 'context', 'usage'],
      gitStatus: { enabled: true, showDirty: true, showAheadBehind: false, showFileStats: false, branchOverflow: 'truncate', pushWarningThreshold: 0, pushCriticalThreshold: 0 },
      display: { showModel: true, showProject: true, showContextBar: true, contextValue: 'percent', showConfigCounts: true, showCost: false, showDuration: true, showSpeed: false, showTokenBreakdown: true, showUsage: true, usageValue: 'percent', usageBarEnabled: false, showResetLabel: true, showTools: true, showSkills: false, showMcp: false, showAgents: true, showTodos: true, showSessionTokens: false, showSessionName: false, showClaudeCodeVersion: false, showMemoryUsage: false, showPromptCache: false, showOutputStyle: false, mergeGroups: [['context', 'usage']], autocompactBuffer: 'enabled', usageThreshold: 0, sevenDayThreshold: 80, environmentThreshold: 0, customLine: '' },
      colors: {
        context: 'green',
        usage: 'brightBlue',
        warning: 'yellow',
        usageWarning: 'brightMagenta',
        critical: 'red',
        model: 'cyan',
        project: 'yellow',
        git: 'magenta',
        gitBranch: 'cyan',
        label: 'dim',
        custom: 208,
      },
    },
  };
}

test('renderUsageLine returns null when showUsage is false', () => {
  const ctx = baseContext();
  ctx.config.display.showUsage = false;
  assert.equal(renderUsageLine(ctx), null);
});

test('renderUsageLine returns null when usageData is null', () => {
  const ctx = baseContext();
  ctx.usageData = null;
  assert.equal(renderUsageLine(ctx), null);
});

test('renderUsageLine returns null when usage below threshold', () => {
  const ctx = baseContext();
  ctx.config.display.usageThreshold = 50;
  ctx.usageData.fiveHour = 25;
  assert.equal(renderUsageLine(ctx), null);
});

test('renderUsageLine shows balance label when below threshold', () => {
  const ctx = baseContext();
  ctx.config.display.usageThreshold = 50;
  ctx.usageData.fiveHour = 25;
  ctx.usageData.balanceLabel = '¥6.35';
  const line = stripAnsi(renderUsageLine(ctx) ?? '');
  assert.ok(line.includes('¥6.35'));
});

test('renderUsageLine shows limit reached warning', () => {
  const ctx = baseContext();
  ctx.usageData.fiveHour = 100;
  ctx.usageData.fiveHourResetAt = new Date(Date.now() + 60 * 60 * 1000);
  const line = stripAnsi(renderUsageLine(ctx) ?? '');
  assert.ok(line.includes('Limit reached'));
});

test('renderUsageLine shows limit reached in compact mode', () => {
  const ctx = baseContext();
  ctx.config.display.usageCompact = true;
  ctx.usageData.fiveHour = 100;
  ctx.usageData.fiveHourResetAt = new Date(Date.now() + 60 * 60 * 1000);
  const line = stripAnsi(renderUsageLine(ctx) ?? '');
  assert.ok(line.includes('Limit'));
});

test('renderUsageLine shows limit reached with balance label', () => {
  const ctx = baseContext();
  ctx.usageData.fiveHour = 100;
  ctx.usageData.fiveHourResetAt = new Date(Date.now() + 60 * 60 * 1000);
  ctx.usageData.balanceLabel = '$10.00';
  const line = stripAnsi(renderUsageLine(ctx) ?? '');
  assert.ok(line.includes('Limit reached'));
  assert.ok(line.includes('$10.00'));
});

test('renderUsageLine compact mode with fiveHour only', () => {
  const ctx = baseContext();
  ctx.config.display.usageCompact = true;
  ctx.usageData.fiveHour = 50;
  ctx.usageData.fiveHourResetAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const line = stripAnsi(renderUsageLine(ctx) ?? '');
  assert.ok(line.includes('5h:'));
  assert.ok(line.includes('50%'));
});

test('renderUsageLine compact mode with both windows', () => {
  const ctx = baseContext();
  ctx.config.display.usageCompact = true;
  ctx.usageData.fiveHour = 60;
  ctx.usageData.sevenDay = 85;
  ctx.usageData.fiveHourResetAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  ctx.usageData.sevenDayResetAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const line = stripAnsi(renderUsageLine(ctx) ?? '');
  assert.ok(line.includes('5h:'));
  assert.ok(line.includes('7d:'));
});

test('renderUsageLine applies wall-clock options to generic compact windows', () => {
  const ctx = baseContext();
  const resetAt = new Date();
  resetAt.setDate(resetAt.getDate() + 1);
  resetAt.setHours(19, 23, 45, 0);
  ctx.config.display.usageCompact = true;
  ctx.config.display.timeFormat = 'absolute';
  ctx.config.display.hourCycle = 'h23';
  ctx.config.display.showClockSeconds = true;
  ctx.usageData.fiveHour = 60;
  ctx.usageData.sevenDay = 85;
  ctx.usageData.fiveHourResetAt = resetAt;
  ctx.usageData.sevenDayResetAt = resetAt;

  const line = stripAnsi(renderUsageLine(ctx) ?? '');
  assert.match(line, /5h:.*19:23:45/);
  assert.match(line, /7d:.*19:23:45/);
  assert.doesNotMatch(line, /AM|PM/i);
});

test('renderUsageLine compact mode returns null when no window data qualifies', () => {
  const ctx = baseContext();
  ctx.config.display.usageCompact = true;
  ctx.usageData.fiveHour = null;
  ctx.usageData.sevenDay = null;
  ctx.usageData.fiveHourResetAt = null;
  ctx.usageData.sevenDayResetAt = null;
  const result = renderUsageLine(ctx);
  assert.equal(result, null);
});

test('renderUsageLine shows seven-day only when fiveHour is null', () => {
  const ctx = baseContext();
  ctx.usageData.fiveHour = null;
  ctx.usageData.sevenDay = 45;
  ctx.usageData.sevenDayResetAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
  const line = stripAnsi(renderUsageLine(ctx) ?? '');
  assert.ok(line.includes('Weekly'));
});

test('renderUsageLine shows both windows when sevenDay exceeds threshold', () => {
  const ctx = baseContext();
  ctx.usageData.fiveHour = 40;
  ctx.usageData.sevenDay = 85;
  ctx.usageData.fiveHourResetAt = new Date(Date.now() + 3 * 60 * 60 * 1000);
  ctx.usageData.sevenDayResetAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
  const line = stripAnsi(renderUsageLine(ctx) ?? '');
  assert.ok(line.includes('40%'));
  assert.ok(line.includes('Weekly'));
});

test('renderUsageLine with bar enabled', () => {
  const ctx = baseContext();
  ctx.config.display.usageBarEnabled = true;
  ctx.usageData.fiveHour = 60;
  const line = renderUsageLine(ctx);
  // Bar includes ANSI codes; just check it renders something
  assert.ok(line);
});

test('renderUsageLine absolute time format', () => {
  const ctx = baseContext();
  ctx.config.display.timeFormat = 'absolute';
  ctx.usageData.fiveHour = 50;
  ctx.usageData.fiveHourResetAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const line = stripAnsi(renderUsageLine(ctx) ?? '');
  assert.ok(line.includes('resets at'));
});

test('renderUsageLine elapsed time format', () => {
  const ctx = baseContext();
  ctx.config.display.timeFormat = 'elapsed';
  ctx.usageData.fiveHour = 50;
  ctx.usageData.fiveHourResetAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const line = stripAnsi(renderUsageLine(ctx) ?? '');
  assert.ok(line.includes('elapsed'));
});

test('renderUsageLine elapsedAndAbsolute time format', () => {
  const ctx = baseContext();
  ctx.config.display.timeFormat = 'elapsedAndAbsolute';
  ctx.usageData.fiveHour = 50;
  ctx.usageData.fiveHourResetAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const line = stripAnsi(renderUsageLine(ctx) ?? '');
  assert.ok(line.includes('elapsed'));
});

test('renderUsageLine remaining usage value mode', () => {
  const ctx = baseContext();
  ctx.config.display.usageValue = 'remaining';
  ctx.usageData.fiveHour = 40;
  const line = stripAnsi(renderUsageLine(ctx) ?? '');
  // remaining = 100 - 40 = 60%
  assert.ok(line.includes('60%'));
});

test('renderUsageLine hides reset label when showResetLabel is false', () => {
  const ctx = baseContext();
  ctx.config.display.showResetLabel = false;
  ctx.usageData.fiveHour = 50;
  ctx.usageData.fiveHourResetAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const line = stripAnsi(renderUsageLine(ctx) ?? '');
  assert.ok(!line.includes('Resets in'));
});

test('renderUsageLine with only balanceLabel and no window data', () => {
  const ctx = baseContext();
  ctx.usageData.fiveHour = null;
  ctx.usageData.sevenDay = null;
  ctx.usageData.fiveHourResetAt = null;
  ctx.usageData.sevenDayResetAt = null;
  ctx.usageData.balanceLabel = '$5.00';
  const line = stripAnsi(renderUsageLine(ctx) ?? '');
  assert.ok(line.includes('$5.00'));
});

test('renderUsageLine with null percent shows -- in compact mode', () => {
  const ctx = baseContext();
  ctx.config.display.usageCompact = true;
  ctx.usageData.fiveHour = null;
  ctx.usageData.sevenDay = 85;
  ctx.usageData.sevenDayResetAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const line = stripAnsi(renderUsageLine(ctx) ?? '');
  assert.ok(line.includes('7d:'));
});

test('renderUsageLine limit reached with sevenDay at 100', () => {
  const ctx = baseContext();
  ctx.usageData.fiveHour = 80;
  ctx.usageData.sevenDay = 100;
  ctx.usageData.sevenDayResetAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
  const line = stripAnsi(renderUsageLine(ctx) ?? '');
  assert.ok(line.includes('Limit reached'));
});

test('renderUsageLine limit reached compact mode without reset time', () => {
  const ctx = baseContext();
  ctx.config.display.usageCompact = true;
  ctx.usageData.fiveHour = 100;
  ctx.usageData.fiveHourResetAt = null;
  const line = stripAnsi(renderUsageLine(ctx) ?? '');
  assert.ok(line.includes('Limit'));
});

test('renderUsageLine limit reached with balance in compact mode', () => {
  const ctx = baseContext();
  ctx.config.display.usageCompact = true;
  ctx.usageData.fiveHour = 100;
  ctx.usageData.fiveHourResetAt = new Date(Date.now() + 60 * 60 * 1000);
  ctx.usageData.balanceLabel = '$2.50';
  const line = stripAnsi(renderUsageLine(ctx) ?? '');
  assert.ok(line.includes('$2.50'));
});

test('renderUsageLine elapsed format for limit reached uses relative', () => {
  const ctx = baseContext();
  ctx.config.display.timeFormat = 'elapsed';
  ctx.usageData.fiveHour = 100;
  ctx.usageData.fiveHourResetAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const line = stripAnsi(renderUsageLine(ctx) ?? '');
  assert.ok(line.includes('Limit reached'));
});

test('renderUsageLine elapsedAndAbsolute format for limit uses absolute', () => {
  const ctx = baseContext();
  ctx.config.display.timeFormat = 'elapsedAndAbsolute';
  ctx.usageData.fiveHour = 100;
  ctx.usageData.fiveHourResetAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const line = stripAnsi(renderUsageLine(ctx) ?? '');
  assert.ok(line.includes('Limit reached'));
  assert.ok(line.includes('resets at'));
});
