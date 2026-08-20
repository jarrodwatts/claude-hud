import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { readStdin, getProviderLabel, getContextPercent, getBufferedPercent } from '../dist/stdin.js';
import { mergeConfig } from '../dist/config.js';

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

function createPipe() {
  const stream = new PassThrough();
  Object.defineProperty(stream, 'isTTY', { value: false, configurable: true });
  return stream;
}

test('readStdin parses valid JSON without waiting for EOF', async () => {
  const stream = createPipe();
  const resultPromise = readStdin(stream, { firstByteTimeoutMs: 20, idleTimeoutMs: 10 });

  stream.write('{"cwd":"/tmp/project","model":{"display_name":"Opus"}}');

  const result = await resultPromise;
  assert.deepEqual(result, {
    cwd: '/tmp/project',
    model: { display_name: 'Opus' },
  });
});

test('readStdin parses JSON split across multiple chunks', async () => {
  const stream = createPipe();
  const resultPromise = readStdin(stream, { firstByteTimeoutMs: 20, idleTimeoutMs: 10 });

  stream.write('{"cwd":"/tmp/project",');
  stream.write('"model":{"display_name":"Opus"}}');

  const result = await resultPromise;
  assert.deepEqual(result, {
    cwd: '/tmp/project',
    model: { display_name: 'Opus' },
  });
});

test('readStdin returns null when a non-TTY stream never produces data', async () => {
  const stream = createPipe();
  const result = await readStdin(stream, { firstByteTimeoutMs: 10, idleTimeoutMs: 5 });
  assert.equal(result, null);
});

test('readStdin returns null when partial JSON goes idle', async () => {
  const stream = createPipe();
  const resultPromise = readStdin(stream, { firstByteTimeoutMs: 20, idleTimeoutMs: 10 });

  stream.write('{"cwd":"/tmp/project"');

  const result = await resultPromise;
  assert.equal(result, null);
});

test('readStdin returns null when stdin payload exceeds the safety limit', async () => {
  const stream = createPipe();
  const resultPromise = readStdin(stream, {
    firstByteTimeoutMs: 20,
    idleTimeoutMs: 10,
    maxBytes: 16,
  });

  stream.write('{"cwd":"/tmp/project"}');

  const result = await resultPromise;
  assert.equal(result, null);
});

test('context percents preserve default behavior when autoCompactWindow is omitted or null', () => {
  const stdin = {
    context_window: {
      current_usage: { input_tokens: 70600 },
      context_window_size: 1000000,
    },
  };

  assert.equal(getContextPercent(stdin), 7);
  assert.equal(getContextPercent(stdin, null), 7);
  assert.equal(getBufferedPercent(stdin), 8);
  assert.equal(getBufferedPercent(stdin, null), 8);
});

test('context percents use autoCompactWindow as denominator when configured', () => {
  const stdin = {
    context_window: {
      current_usage: { input_tokens: 70600 },
      context_window_size: 1000000,
    },
  };

  assert.equal(getContextPercent(stdin, 200000), 35);
  assert.equal(getBufferedPercent(stdin, 200000), 35);
});

test('context percents clamp autoCompactWindow usage to 100', () => {
  const stdin = {
    context_window: {
      current_usage: { input_tokens: 250000 },
      context_window_size: 1000000,
    },
  };

  assert.equal(getContextPercent(stdin, 200000), 100);
  assert.equal(getBufferedPercent(stdin, 200000), 100);
});

test('mergeConfig validates display.autoCompactWindow', () => {
  for (const value of [0, -5, 0.5, 200000.5, Number.NaN, 'abc']) {
    assert.equal(mergeConfig({ display: { autoCompactWindow: value } }).display.autoCompactWindow, null);
  }

  assert.equal(mergeConfig({ display: { autoCompactWindow: 200000 } }).display.autoCompactWindow, 200000);
});

test('autoCompactWindow overrides native used_percentage', () => {
  const stdin = {
    context_window: {
      used_percentage: 7,
      current_usage: { input_tokens: 70600 },
      context_window_size: 1000000,
    },
  };

  assert.equal(getContextPercent(stdin, 200000), 35);
});

// getProviderLabel tests

test('getProviderLabel returns Bedrock when CLAUDE_CODE_USE_BEDROCK=1', () => {
  const orig = process.env.CLAUDE_CODE_USE_BEDROCK;
  try {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1';
    const result = getProviderLabel({ model: { id: 'claude-sonnet-4-6' } });
    assert.equal(result, 'Bedrock');
  } finally {
    if (orig === undefined) delete process.env.CLAUDE_CODE_USE_BEDROCK;
    else process.env.CLAUDE_CODE_USE_BEDROCK = orig;
  }
});

test('getProviderLabel returns null when CLAUDE_CODE_USE_BEDROCK is not set', () => {
  const orig = process.env.CLAUDE_CODE_USE_BEDROCK;
  try {
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
    const result = getProviderLabel({ model: { id: 'anthropic.claude-sonnet-4-6' } });
    assert.equal(result, null);
  } finally {
    if (orig === undefined) delete process.env.CLAUDE_CODE_USE_BEDROCK;
    else process.env.CLAUDE_CODE_USE_BEDROCK = orig;
  }
});

test('getProviderLabel returns null for cross-region model ID without env var', () => {
  const orig = process.env.CLAUDE_CODE_USE_BEDROCK;
  try {
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
    const result = getProviderLabel({ model: { id: 'us.anthropic.claude-sonnet-4-6' } });
    assert.equal(result, null);
  } finally {
    if (orig === undefined) delete process.env.CLAUDE_CODE_USE_BEDROCK;
    else process.env.CLAUDE_CODE_USE_BEDROCK = orig;
  }
});

test('getProviderLabel returns null when CLAUDE_CODE_USE_BEDROCK=0', () => {
  const orig = process.env.CLAUDE_CODE_USE_BEDROCK;
  try {
    process.env.CLAUDE_CODE_USE_BEDROCK = '0';
    const result = getProviderLabel({ model: { id: 'anthropic.claude-sonnet-4-6' } });
    assert.equal(result, null);
  } finally {
    if (orig === undefined) delete process.env.CLAUDE_CODE_USE_BEDROCK;
    else process.env.CLAUDE_CODE_USE_BEDROCK = orig;
  }
});

test('getProviderLabel recognizes both MiniMax Anthropic endpoints', () => {
  const originalBaseUrl = process.env.ANTHROPIC_BASE_URL;
  const originalApiBaseUrl = process.env.ANTHROPIC_API_BASE_URL;

  try {
    delete process.env.ANTHROPIC_API_BASE_URL;
    process.env.ANTHROPIC_BASE_URL = 'https://api.minimax.io/anthropic';
    assert.equal(getProviderLabel({ model: { id: 'MiniMax-M3' } }), 'MiniMax');

    delete process.env.ANTHROPIC_BASE_URL;
    process.env.ANTHROPIC_API_BASE_URL = 'https://api.minimaxi.com/anthropic/';
    assert.equal(getProviderLabel({ model: { id: 'MiniMax-M3' } }), 'MiniMax');
  } finally {
    if (originalBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = originalBaseUrl;
    if (originalApiBaseUrl === undefined) delete process.env.ANTHROPIC_API_BASE_URL;
    else process.env.ANTHROPIC_API_BASE_URL = originalApiBaseUrl;
  }
});

test('getProviderLabel rejects lookalike MiniMax endpoints', () => {
  const originalBaseUrl = process.env.ANTHROPIC_BASE_URL;
  const originalApiBaseUrl = process.env.ANTHROPIC_API_BASE_URL;

  try {
    delete process.env.ANTHROPIC_API_BASE_URL;
    process.env.ANTHROPIC_BASE_URL = 'https://proxy.api.minimax.io/anthropic';
    assert.equal(getProviderLabel({ model: { id: 'MiniMax-M3' } }), null);
  } finally {
    if (originalBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = originalBaseUrl;
    if (originalApiBaseUrl === undefined) delete process.env.ANTHROPIC_API_BASE_URL;
    else process.env.ANTHROPIC_API_BASE_URL = originalApiBaseUrl;
  }
});

test('getProviderLabel recognizes the OrcaRouter Anthropic endpoint', () => {
  const originalBaseUrl = process.env.ANTHROPIC_BASE_URL;
  const originalApiBaseUrl = process.env.ANTHROPIC_API_BASE_URL;

  try {
    delete process.env.ANTHROPIC_API_BASE_URL;
    process.env.ANTHROPIC_BASE_URL = 'https://api.orcarouter.ai';
    assert.equal(getProviderLabel({ model: { id: 'anthropic/claude-sonnet-5' } }), 'OrcaRouter');

    delete process.env.ANTHROPIC_BASE_URL;
    process.env.ANTHROPIC_API_BASE_URL = 'https://api.orcarouter.ai/';
    assert.equal(getProviderLabel({ model: { id: 'anthropic/claude-sonnet-5' } }), 'OrcaRouter');
  } finally {
    if (originalBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = originalBaseUrl;
    if (originalApiBaseUrl === undefined) delete process.env.ANTHROPIC_API_BASE_URL;
    else process.env.ANTHROPIC_API_BASE_URL = originalApiBaseUrl;
  }
});

test('getProviderLabel rejects lookalike OrcaRouter endpoints', () => {
  const originalBaseUrl = process.env.ANTHROPIC_BASE_URL;
  const originalApiBaseUrl = process.env.ANTHROPIC_API_BASE_URL;

  try {
    delete process.env.ANTHROPIC_API_BASE_URL;
    process.env.ANTHROPIC_BASE_URL = 'https://proxy.orcarouter.ai';
    assert.equal(getProviderLabel({ model: { id: 'anthropic/claude-sonnet-5' } }), null);
  } finally {
    if (originalBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = originalBaseUrl;
    if (originalApiBaseUrl === undefined) delete process.env.ANTHROPIC_API_BASE_URL;
    else process.env.ANTHROPIC_API_BASE_URL = originalApiBaseUrl;
  }
});
