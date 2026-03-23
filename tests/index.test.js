import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSessionDuration, main } from '../dist/index.js';

test('formatSessionDuration returns empty string without session start', () => {
  assert.equal(formatSessionDuration(undefined, () => 0), '');
});

test('formatSessionDuration formats sub-minute and minute durations', () => {
  const start = new Date(0);
  assert.equal(formatSessionDuration(start, () => 30 * 1000), '<1m');
  assert.equal(formatSessionDuration(start, () => 5 * 60 * 1000), '5m');
});

test('formatSessionDuration formats hour durations', () => {
  const start = new Date(0);
  assert.equal(formatSessionDuration(start, () => 2 * 60 * 60 * 1000 + 5 * 60 * 1000), '2h 5m');
});

test('formatSessionDuration uses Date.now by default', () => {
  const originalNow = Date.now;
  Date.now = () => 60000;
  try {
    const result = formatSessionDuration(new Date(0));
    assert.equal(result, '1m');
  } finally {
    Date.now = originalNow;
  }
});

test('main logs an error when dependencies throw', async () => {
  const logs = [];
  await main({
    readStdin: async () => {
      throw new Error('boom');
    },
    parseTranscript: async () => ({ tools: [], agents: [], todos: [] }),
    countConfigs: async () => ({ claudeMdCount: 0, rulesCount: 0, mcpCount: 0, hooksCount: 0 }),
    getGitBranch: async () => null,
    getUsage: async () => null,
    render: () => {},
    now: () => Date.now(),
    log: (...args) => logs.push(args.join(' ')),
  });

  assert.ok(logs.some((line) => line.includes('[claude-hud] Error:')));
});

test('main logs unknown error for non-Error throws', async () => {
  const logs = [];
  await main({
    readStdin: async () => {
      throw 'boom';
    },
    parseTranscript: async () => ({ tools: [], agents: [], todos: [] }),
    countConfigs: async () => ({ claudeMdCount: 0, rulesCount: 0, mcpCount: 0, hooksCount: 0 }),
    getGitBranch: async () => null,
    getUsage: async () => null,
    render: () => {},
    now: () => Date.now(),
    log: (...args) => logs.push(args.join(' ')),
  });

  assert.ok(logs.some((line) => line.includes('Unknown error')));
});

test('index entrypoint runs when executed directly', async () => {
  const originalArgv = [...process.argv];
  const originalIsTTY = process.stdin.isTTY;
  const originalLog = console.log;
  const logs = [];

  try {
    const moduleUrl = new URL('../dist/index.js', import.meta.url);
    process.argv[1] = new URL(moduleUrl).pathname;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    console.log = (...args) => logs.push(args.join(' '));
    await import(`${moduleUrl}?entry=${Date.now()}`);
  } finally {
    console.log = originalLog;
    process.argv = originalArgv;
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
  }

  assert.ok(logs.some((line) => line.includes('[claude-hud] Initializing...')));
});

test('main executes the happy path with default dependencies', async () => {
  const originalNow = Date.now;
  Date.now = () => 60000;
  let renderedContext;

  try {
    await main({
      readStdin: async () => ({
        model: { display_name: 'Opus' },
        context_window: { context_window_size: 100, current_usage: { input_tokens: 90 } },
      }),
      parseTranscript: async () => ({ tools: [], agents: [], todos: [], sessionStart: new Date(0) }),
      countConfigs: async () => ({ claudeMdCount: 0, rulesCount: 0, mcpCount: 0, hooksCount: 0 }),
      getGitBranch: async () => null,
      getUsage: async () => null,
      render: (ctx) => {
        renderedContext = ctx;
      },
    });
  } finally {
    Date.now = originalNow;
  }

  assert.equal(renderedContext?.sessionDuration, '1m');
});

test('main includes git status in render context', async () => {
  let renderedContext;

  await main({
    readStdin: async () => ({
      model: { display_name: 'Opus' },
      context_window: { context_window_size: 100, current_usage: { input_tokens: 10 } },
      cwd: '/some/path',
    }),
    parseTranscript: async () => ({ tools: [], agents: [], todos: [] }),
    countConfigs: async () => ({ claudeMdCount: 0, rulesCount: 0, mcpCount: 0, hooksCount: 0 }),
    getGitStatus: async () => ({ branch: 'feature/test', isDirty: false, ahead: 0, behind: 0 }),
    getUsage: async () => null,
    loadConfig: async () => ({
      lineLayout: 'compact',
      showSeparators: false,
      pathLevels: 1,
      gitStatus: { enabled: true, showDirty: true, showAheadBehind: false, showFileStats: false },
      display: { showModel: true, showContextBar: true, contextValue: 'percent', showConfigCounts: true, showDuration: true, showSpeed: false, showTokenBreakdown: true, showUsage: true, showTools: true, showAgents: true, showTodos: true, showClaudeCodeVersion: false, showMemoryUsage: false, autocompactBuffer: 'enabled', usageThreshold: 0, sevenDayThreshold: 80, environmentThreshold: 0 },
    }),
    render: (ctx) => {
      renderedContext = ctx;
    },
  });

  assert.equal(renderedContext?.gitStatus?.branch, 'feature/test');
});

test('main includes usageData in render context', async () => {
  let renderedContext;

  await main({
    readStdin: async () => ({
      model: { display_name: 'Opus' },
      context_window: { context_window_size: 100, current_usage: { input_tokens: 10 } },
      rate_limits: {
        five_hour: { used_percentage: 49.6, resets_at: 1710000000 },
        seven_day: { used_percentage: 25.2, resets_at: 1710600000 },
      },
    }),
    parseTranscript: async () => ({ tools: [], agents: [], todos: [] }),
    countConfigs: async () => ({ claudeMdCount: 0, rulesCount: 0, mcpCount: 0, hooksCount: 0 }),
    getGitBranch: async () => null,
    render: (ctx) => {
      renderedContext = ctx;
    },
  });

  assert.deepEqual(renderedContext?.usageData, {
    fiveHour: 50,
    sevenDay: 25,
    fiveHourResetAt: new Date(1710000000 * 1000),
    sevenDayResetAt: new Date(1710600000 * 1000),
  });
});

test('main uses stdin-native rate_limits when available', async () => {
  let renderedContext;

  await main({
    readStdin: async () => ({
      model: { display_name: 'Opus' },
      rate_limits: {
        five_hour: { used_percentage: 21.9, resets_at: 1710000000 },
        seven_day: { used_percentage: 55.2, resets_at: 1710600000 },
      },
    }),
    parseTranscript: async () => ({ tools: [], agents: [], todos: [] }),
    countConfigs: async () => ({ claudeMdCount: 0, rulesCount: 0, mcpCount: 0, hooksCount: 0 }),
    getGitStatus: async () => null,
    render: (ctx) => {
      renderedContext = ctx;
    },
  });

  assert.deepEqual(renderedContext?.usageData, {
    fiveHour: 22,
    sevenDay: 55,
    fiveHourResetAt: new Date(1710000000 * 1000),
    sevenDayResetAt: new Date(1710600000 * 1000),
  });
});

test('main leaves usageData null when stdin rate_limits are absent', async () => {
  let renderedContext;

  await main({
    readStdin: async () => ({
      model: { display_name: 'Opus' },
      context_window: { context_window_size: 100, current_usage: { input_tokens: 10 } },
    }),
    parseTranscript: async () => ({ tools: [], agents: [], todos: [] }),
    countConfigs: async () => ({ claudeMdCount: 0, rulesCount: 0, mcpCount: 0, hooksCount: 0 }),
    getGitStatus: async () => null,
    render: (ctx) => {
      renderedContext = ctx;
    },
  });

  assert.equal(renderedContext?.usageData, null);
});

test('main includes Claude Code version in render context only when enabled', async () => {
  let renderedContext;
  let lookupCalls = 0;

  await main({
    readStdin: async () => ({
      model: { display_name: 'Opus' },
      context_window: { context_window_size: 100, current_usage: { input_tokens: 10 } },
    }),
    parseTranscript: async () => ({ tools: [], agents: [], todos: [] }),
    countConfigs: async () => ({ claudeMdCount: 0, rulesCount: 0, mcpCount: 0, hooksCount: 0 }),
    getGitStatus: async () => null,
    getUsage: async () => null,
    loadConfig: async () => ({
      lineLayout: 'compact',
      showSeparators: false,
      pathLevels: 1,
      gitStatus: { enabled: true, showDirty: true, showAheadBehind: false, showFileStats: false },
      display: { showModel: true, showContextBar: true, contextValue: 'percent', showConfigCounts: true, showDuration: true, showSpeed: false, showTokenBreakdown: true, showUsage: true, showTools: false, showAgents: false, showTodos: false, showClaudeCodeVersion: true, showMemoryUsage: false, autocompactBuffer: 'enabled', usageThreshold: 0, sevenDayThreshold: 80, environmentThreshold: 0 },
    }),
    getClaudeCodeVersion: async () => {
      lookupCalls += 1;
      return '2.1.81';
    },
    render: (ctx) => {
      renderedContext = ctx;
    },
  });

  assert.equal(lookupCalls, 1);
  assert.equal(renderedContext?.claudeCodeVersion, '2.1.81');
});

test('main skips Claude Code version lookup when disabled', async () => {
  let lookupCalls = 0;

  await main({
    readStdin: async () => ({
      model: { display_name: 'Opus' },
      context_window: { context_window_size: 100, current_usage: { input_tokens: 10 } },
    }),
    parseTranscript: async () => ({ tools: [], agents: [], todos: [] }),
    countConfigs: async () => ({ claudeMdCount: 0, rulesCount: 0, mcpCount: 0, hooksCount: 0 }),
    getGitStatus: async () => null,
    getUsage: async () => null,
    loadConfig: async () => ({
      lineLayout: 'compact',
      showSeparators: false,
      pathLevels: 1,
      gitStatus: { enabled: true, showDirty: true, showAheadBehind: false, showFileStats: false },
      display: { showModel: true, showContextBar: true, contextValue: 'percent', showConfigCounts: true, showDuration: true, showSpeed: false, showTokenBreakdown: true, showUsage: true, showTools: false, showAgents: false, showTodos: false, showClaudeCodeVersion: false, showMemoryUsage: false, autocompactBuffer: 'enabled', usageThreshold: 0, sevenDayThreshold: 80, environmentThreshold: 0 },
    }),
    getClaudeCodeVersion: async () => {
      lookupCalls += 1;
      return '2.1.81';
    },
    render: () => {},
  });

  assert.equal(lookupCalls, 0);
});

test('main includes memoryUsage in render context only for expanded layout when enabled', async () => {
  let renderedContext;
  let lookupCalls = 0;
  const mockMemoryUsage = {
    totalBytes: 16 * 1024 ** 3,
    usedBytes: 10 * 1024 ** 3,
    freeBytes: 6 * 1024 ** 3,
    usedPercent: 63,
  };

  await main({
    readStdin: async () => ({
      model: { display_name: 'Opus' },
      context_window: { context_window_size: 100, current_usage: { input_tokens: 10 } },
    }),
    parseTranscript: async () => ({ tools: [], agents: [], todos: [] }),
    countConfigs: async () => ({ claudeMdCount: 0, rulesCount: 0, mcpCount: 0, hooksCount: 0 }),
    getGitStatus: async () => null,
    getUsage: async () => null,
    loadConfig: async () => ({
      lineLayout: 'expanded',
      showSeparators: false,
      pathLevels: 1,
      gitStatus: { enabled: true, showDirty: true, showAheadBehind: false, showFileStats: false },
      display: { showModel: true, showContextBar: true, contextValue: 'percent', showConfigCounts: true, showDuration: true, showSpeed: false, showTokenBreakdown: true, showUsage: true, showTools: false, showAgents: false, showTodos: false, showClaudeCodeVersion: false, showMemoryUsage: true, autocompactBuffer: 'enabled', usageThreshold: 0, sevenDayThreshold: 80, environmentThreshold: 0 },
    }),
    getMemoryUsage: async () => {
      lookupCalls += 1;
      return mockMemoryUsage;
    },
    render: (ctx) => {
      renderedContext = ctx;
    },
  });

  assert.equal(lookupCalls, 1);
  assert.deepEqual(renderedContext?.memoryUsage, mockMemoryUsage);
});

test('main skips memoryUsage lookup for compact layout even when enabled', async () => {
  let lookupCalls = 0;

  await main({
    readStdin: async () => ({
      model: { display_name: 'Opus' },
      context_window: { context_window_size: 100, current_usage: { input_tokens: 10 } },
    }),
    parseTranscript: async () => ({ tools: [], agents: [], todos: [] }),
    countConfigs: async () => ({ claudeMdCount: 0, rulesCount: 0, mcpCount: 0, hooksCount: 0 }),
    getGitStatus: async () => null,
    getUsage: async () => null,
    loadConfig: async () => ({
      lineLayout: 'compact',
      showSeparators: false,
      pathLevels: 1,
      gitStatus: { enabled: true, showDirty: true, showAheadBehind: false, showFileStats: false },
      display: { showModel: true, showContextBar: true, contextValue: 'percent', showConfigCounts: true, showDuration: true, showSpeed: false, showTokenBreakdown: true, showUsage: true, showTools: false, showAgents: false, showTodos: false, showClaudeCodeVersion: false, showMemoryUsage: true, autocompactBuffer: 'enabled', usageThreshold: 0, sevenDayThreshold: 80, environmentThreshold: 0 },
    }),
    getMemoryUsage: async () => {
      lookupCalls += 1;
      return null;
    },
    render: () => {},
  });

  assert.equal(lookupCalls, 0);
});
