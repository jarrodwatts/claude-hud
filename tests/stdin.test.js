import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStdin, getContextPercent, getBufferedPercent, getEffectiveContextSize } from '../dist/stdin.js';

function makeStdin(modelId, displayName, inputTokens, windowSize) {
  return {
    model: { id: modelId, display_name: displayName },
    context_window: {
      context_window_size: windowSize,
      current_usage: { input_tokens: inputTokens },
    },
  };
}

function makeConfig(overrides) {
  return {
    lineLayout: 'expanded',
    showSeparators: false,
    pathLevels: 1,
    elementOrder: [],
    gitStatus: { enabled: true, showDirty: true, showAheadBehind: false, showFileStats: false },
    display: {
      showModel: true, showProject: true, showContextBar: true, contextValue: 'percent',
      showConfigCounts: false, showDuration: false, showSpeed: false, showTokenBreakdown: true,
      showUsage: true, usageBarEnabled: true, showTools: false, showAgents: false, showTodos: false,
      showSessionName: false, autocompactBuffer: 'enabled', usageThreshold: 0, sevenDayThreshold: 80,
      environmentThreshold: 0, customLine: '', contextSizeOverrides: overrides,
    },
    usage: { cacheTtlSeconds: 60, failureCacheTtlSeconds: 15 },
    colors: { context: 'green', usage: 'brightBlue', warning: 'yellow', usageWarning: 'brightMagenta', critical: 'red' },
  };
}

test('readStdin returns null for TTY input', async () => {
  const originalIsTTY = process.stdin.isTTY;
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

  try {
    const result = await readStdin();
    assert.equal(result, null);
  } finally {
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
  }
});

test('readStdin returns null on stream errors', async () => {
  const originalIsTTY = process.stdin.isTTY;
  const originalSetEncoding = process.stdin.setEncoding;
  Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
  process.stdin.setEncoding = () => {
    throw new Error('boom');
  };

  try {
    const result = await readStdin();
    assert.equal(result, null);
  } finally {
    process.stdin.setEncoding = originalSetEncoding;
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
  }
});

// --- getEffectiveContextSize tests ---

test('getEffectiveContextSize returns stdin size when no overrides', () => {
  const stdin = makeStdin('claude-opus-4-6', 'Opus', 45000, 200000);
  assert.equal(getEffectiveContextSize(stdin), 200000);
  assert.equal(getEffectiveContextSize(stdin, makeConfig({})), 200000);
});

test('getEffectiveContextSize matches by model.id first', () => {
  const stdin = makeStdin('claude-opus-4-6', 'Opus', 45000, 200000);
  const config = makeConfig({ 'claude-opus': 150000 });
  assert.equal(getEffectiveContextSize(stdin, config), 150000);
});

test('getEffectiveContextSize matches by display_name', () => {
  const stdin = makeStdin('some-id', 'GPT-5.4', 45000, 200000);
  const config = makeConfig({ 'GPT-5.4': 256000 });
  assert.equal(getEffectiveContextSize(stdin, config), 256000);
});

test('getEffectiveContextSize is case-insensitive', () => {
  const stdin = makeStdin('claude-opus-4-6', 'Opus', 45000, 200000);
  const config = makeConfig({ 'opus': 100000 });
  assert.equal(getEffectiveContextSize(stdin, config), 100000);
});

test('getEffectiveContextSize prefers exact match over substring', () => {
  const stdin = makeStdin('gpt-5.4', 'GPT-5.4', 45000, 200000);
  const config = makeConfig({ 'gpt': 128000, 'gpt-5.4': 256000 });
  assert.equal(getEffectiveContextSize(stdin, config), 256000);
});

test('getEffectiveContextSize prefers longer substring over shorter', () => {
  const stdin = makeStdin('claude-opus-4-6', 'Claude Opus 4', 45000, 200000);
  const config = makeConfig({ 'opus': 100000, 'claude-opus': 150000 });
  assert.equal(getEffectiveContextSize(stdin, config), 150000);
});

test('getEffectiveContextSize falls back to generic when specific not matched', () => {
  const stdin = makeStdin('gpt-4o', 'GPT-4o', 45000, 200000);
  const config = makeConfig({ 'gpt': 128000, 'gpt-5.4': 256000 });
  assert.equal(getEffectiveContextSize(stdin, config), 128000);
});

// --- getContextPercent with overrides ---

test('getContextPercent uses override size for calculation', () => {
  const stdin = makeStdin('claude-opus-4-6', 'Opus', 50000, 200000);
  const config = makeConfig({ 'Opus': 100000 });
  // 50000/100000 = 50%
  assert.equal(getContextPercent(stdin, config), 50);
});

test('getContextPercent uses raw calculation (no buffer) with override', () => {
  const stdin = makeStdin('claude-opus-4-6', 'Opus', 50000, 200000);
  const config = makeConfig({ 'Opus': 100000 });
  const percent = getContextPercent(stdin, config);
  const buffered = getBufferedPercent(stdin, config);
  // Both should use raw calculation when override is active
  // getContextPercent = raw = 50000/100000 = 50%
  assert.equal(percent, 50);
  // getBufferedPercent adds buffer but on the override size
  assert.ok(buffered >= percent, 'buffered should be >= raw');
});
