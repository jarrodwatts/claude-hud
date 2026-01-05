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
    getGitStatus: async () => null,
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
    getGitStatus: async () => null,
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
      getGitStatus: async () => null,
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
    getGitStatus: async () => ({ branch: 'feature/test', isDirty: true, ahead: 1, behind: 0 }),
    render: (ctx) => {
      renderedContext = ctx;
    },
  });

  assert.equal(renderedContext?.gitStatus?.branch, 'feature/test');
  assert.equal(renderedContext?.gitStatus?.isDirty, true);
  assert.equal(renderedContext?.gitStatus?.ahead, 1);
});
