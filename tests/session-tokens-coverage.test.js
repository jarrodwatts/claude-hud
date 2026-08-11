import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSessionTokensLine } from '../dist/render/lines/session-tokens.js';

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
      display: { showModel: true, showProject: true, showContextBar: true, contextValue: 'percent', showConfigCounts: true, showCost: false, showDuration: true, showSpeed: false, showTokenBreakdown: true, showUsage: true, usageValue: 'percent', usageBarEnabled: false, showResetLabel: true, showTools: true, showSkills: false, showMcp: false, showAgents: true, showTodos: true, showSessionTokens: true, showSessionName: false, showClaudeCodeVersion: false, showMemoryUsage: false, showPromptCache: false, showOutputStyle: false, mergeGroups: [['context', 'usage']], autocompactBuffer: 'enabled', usageThreshold: 0, sevenDayThreshold: 80, environmentThreshold: 0, customLine: '' },
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

test('renderSessionTokensLine returns null when sessionTokens is undefined', () => {
  const ctx = baseContext();
  ctx.transcript.sessionTokens = undefined;
  assert.equal(renderSessionTokensLine(ctx), null);
});

test('renderSessionTokensLine returns null when all token counts are zero', () => {
  const ctx = baseContext();
  ctx.transcript.sessionTokens = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  };
  assert.equal(renderSessionTokensLine(ctx), null);
});

test('renderSessionTokensLine returns null when showSessionTokens is false', () => {
  const ctx = baseContext();
  ctx.config.display.showSessionTokens = false;
  ctx.transcript.sessionTokens = {
    inputTokens: 5000,
    outputTokens: 3000,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  };
  assert.equal(renderSessionTokensLine(ctx), null);
});

test('renderSessionTokensLine renders basic input/output without cache', () => {
  const ctx = baseContext();
  ctx.transcript.sessionTokens = {
    inputTokens: 5000,
    outputTokens: 3000,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  };
  const line = stripAnsi(renderSessionTokensLine(ctx) ?? '');
  assert.ok(line.includes('Tokens'));
  assert.ok(line.includes('8k'));
  assert.ok(line.includes('in: 5k'));
  assert.ok(line.includes('out: 3k'));
  assert.ok(!line.includes('cache:'));
});

test('renderSessionTokensLine includes cache when cache tokens > 0', () => {
  const ctx = baseContext();
  ctx.transcript.sessionTokens = {
    inputTokens: 1000,
    outputTokens: 2000,
    cacheCreationTokens: 500000,
    cacheReadTokens: 100000,
  };
  const line = stripAnsi(renderSessionTokensLine(ctx) ?? '');
  assert.ok(line.includes('cache: 600k'));
});

test('renderSessionTokensLine formats million-level tokens', () => {
  const ctx = baseContext();
  ctx.transcript.sessionTokens = {
    inputTokens: 2000000,
    outputTokens: 1500000,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  };
  const line = stripAnsi(renderSessionTokensLine(ctx) ?? '');
  assert.ok(line.includes('3.5M'));
  assert.ok(line.includes('in: 2.0M'));
  assert.ok(line.includes('out: 1.5M'));
});

test('renderSessionTokensLine formats sub-1000 tokens as raw numbers', () => {
  const ctx = baseContext();
  ctx.transcript.sessionTokens = {
    inputTokens: 500,
    outputTokens: 200,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  };
  const line = stripAnsi(renderSessionTokensLine(ctx) ?? '');
  assert.ok(line.includes('in: 500'));
  assert.ok(line.includes('out: 200'));
});

test('renderSessionTokensLine shows cache only when cacheReadTokens > 0', () => {
  const ctx = baseContext();
  ctx.transcript.sessionTokens = {
    inputTokens: 1000,
    outputTokens: 500,
    cacheCreationTokens: 0,
    cacheReadTokens: 50000,
  };
  const line = stripAnsi(renderSessionTokensLine(ctx) ?? '');
  assert.ok(line.includes('cache: 50k'));
});
