import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderIdentityLine } from '../dist/render/lines/identity.js';

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
    usageData: null,
    memoryUsage: null,
    config: {
      lineLayout: 'compact',
      showSeparators: false,
      pathLevels: 1,
      elementOrder: ['project', 'context', 'usage'],
      gitStatus: { enabled: true, showDirty: true, showAheadBehind: false, showFileStats: false, branchOverflow: 'truncate', pushWarningThreshold: 0, pushCriticalThreshold: 0 },
      display: { showModel: true, showProject: true, showContextBar: true, contextValue: 'percent', showConfigCounts: true, showCost: false, showDuration: true, showSpeed: false, showTokenBreakdown: true, showUsage: true, usageValue: 'percent', usageBarEnabled: false, showResetLabel: true, showTools: true, showSkills: false, showMcp: false, showAgents: true, showTodos: true, showSessionTokens: false, showSessionName: false, showClaudeCodeVersion: false, showMemoryUsage: false, showPromptCache: false, promptCacheTtlSeconds: 300, showOutputStyle: false, mergeGroups: [['context', 'usage']], autocompactBuffer: 'enabled', usageThreshold: 0, sevenDayThreshold: 80, environmentThreshold: 0, customLine: '' },
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

test('renderIdentityLine shows percent by default', () => {
  const ctx = baseContext();
  const line = stripAnsi(renderIdentityLine(ctx));
  assert.ok(line.includes('Context'));
  assert.ok(line.includes('5%'));
});

test('renderIdentityLine shows context in tokens mode', () => {
  const ctx = baseContext();
  ctx.config.display.contextValue = 'tokens';
  const line = stripAnsi(renderIdentityLine(ctx));
  assert.ok(line.includes('10k/200k'));
});

test('renderIdentityLine shows context in both mode', () => {
  const ctx = baseContext();
  ctx.config.display.contextValue = 'both';
  const line = stripAnsi(renderIdentityLine(ctx));
  assert.ok(line.includes('5%'));
  assert.ok(line.includes('10k/200k'));
});

test('renderIdentityLine shows context in remaining mode', () => {
  const ctx = baseContext();
  ctx.config.display.contextValue = 'remaining';
  const line = stripAnsi(renderIdentityLine(ctx));
  assert.ok(line.includes('95%'));
});

test('renderIdentityLine shows tokens mode with no context_window_size', () => {
  const ctx = baseContext();
  ctx.config.display.contextValue = 'tokens';
  ctx.stdin.context_window.context_window_size = 0;
  const line = stripAnsi(renderIdentityLine(ctx));
  assert.ok(line.includes('10k'));
  assert.ok(!line.includes('/'));
});

test('renderIdentityLine shows both mode with no context_window_size', () => {
  const ctx = baseContext();
  ctx.config.display.contextValue = 'both';
  ctx.stdin.context_window.context_window_size = 0;
  const line = stripAnsi(renderIdentityLine(ctx));
  // Without a window size, both mode just shows percent
  assert.match(line, /\d+%/);
});

test('renderIdentityLine hides context bar when showContextBar is false', () => {
  const ctx = baseContext();
  ctx.config.display.showContextBar = false;
  const line = stripAnsi(renderIdentityLine(ctx));
  assert.ok(line.includes('Context'));
  // Should not have a bar (█ characters)
  assert.ok(!line.includes('█'));
});

test('renderIdentityLine shows token breakdown when percent >= critical threshold', () => {
  const ctx = baseContext();
  ctx.stdin.context_window.current_usage.input_tokens = 180000;
  ctx.stdin.context_window.current_usage.cache_creation_input_tokens = 5000;
  ctx.stdin.context_window.current_usage.cache_read_input_tokens = 2000;
  const line = stripAnsi(renderIdentityLine(ctx));
  assert.ok(line.includes('in:'));
  assert.ok(line.includes('cache:'));
});

test('renderIdentityLine hides token breakdown when showTokenBreakdown is false', () => {
  const ctx = baseContext();
  ctx.stdin.context_window.current_usage.input_tokens = 180000;
  ctx.config.display.showTokenBreakdown = false;
  const line = stripAnsi(renderIdentityLine(ctx));
  assert.ok(!line.includes('in:'));
});

test('renderIdentityLine respects custom contextCriticalThreshold', () => {
  const ctx = baseContext();
  // 10k/200k = 5%, set threshold to 5 to trigger breakdown
  ctx.config.display.contextCriticalThreshold = 5;
  const line = stripAnsi(renderIdentityLine(ctx));
  assert.ok(line.includes('in:'));
});

test('renderIdentityLine uses autoCompactWindow for token display', () => {
  const ctx = baseContext();
  ctx.config.display.autoCompactWindow = 100000;
  ctx.config.display.contextValue = 'tokens';
  const line = stripAnsi(renderIdentityLine(ctx));
  // Should show tokens relative to autoCompactWindow (100k) not full window (200k)
  assert.ok(line.includes('10k/100k'));
});

test('renderIdentityLine supports progress label alignment options', () => {
  const ctx = baseContext();
  const lineNoAlign = stripAnsi(renderIdentityLine(ctx, false));
  const lineAlign = stripAnsi(renderIdentityLine(ctx, true));
  const lineAlignOptions = stripAnsi(renderIdentityLine(ctx, { align: true }));
  // Both should contain Context label
  assert.ok(lineNoAlign.includes('Context'));
  assert.ok(lineAlign.includes('Context'));
  assert.equal(lineAlignOptions, lineAlign);
});

test('renderIdentityLine disables autocompact buffer when set to disabled', () => {
  const ctx = baseContext();
  ctx.config.display.autocompactBuffer = 'disabled';
  const line = stripAnsi(renderIdentityLine(ctx));
  assert.ok(line.includes('Context'));
  // Should show raw percent
  assert.ok(line.includes('5%'));
});

test('renderIdentityLine formats million-scale tokens correctly', () => {
  const ctx = baseContext();
  ctx.stdin.context_window.context_window_size = 1000000;
  ctx.stdin.context_window.current_usage.input_tokens = 900000;
  ctx.config.display.contextCriticalThreshold = 85;
  ctx.config.display.contextValue = 'tokens';
  const line = stripAnsi(renderIdentityLine(ctx));
  assert.ok(line.includes('900k/1.0M'));
});

test('renderIdentityLine does not show breakdown when no usage data', () => {
  const ctx = baseContext();
  ctx.stdin.context_window.current_usage = null;
  ctx.stdin.context_window.context_window_size = 200000;
  const line = stripAnsi(renderIdentityLine(ctx));
  assert.ok(line.includes('Context'));
});
