import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderCacheHitRateLine } from '../dist/render/lines/cache-hit-rate.js';
import { setLanguage } from '../dist/i18n/index.js';

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function baseContext() {
  return {
    stdin: {},
    transcript: {
      tools: [],
      agents: [],
      todos: [],
      sessionTokens: {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      },
    },
    claudeMdCount: 0,
    rulesCount: 0,
    mcpCount: 0,
    hooksCount: 0,
    sessionDuration: '',
    gitStatus: null,
    usageData: null,
    memoryUsage: null,
    config: {
      display: {
        showCacheHitRate: true,
      },
      colors: {},
    },
    extraLabel: null,
  };
}

test('renderCacheHitRateLine is hidden when not enabled', () => {
  const ctx = baseContext();
  ctx.config.display.showCacheHitRate = false;
  ctx.transcript.sessionTokens = { inputTokens: 200, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 50_000 };
  assert.equal(renderCacheHitRateLine(ctx), null);
});

test('renderCacheHitRateLine is hidden when sessionTokens is undefined', () => {
  const ctx = baseContext();
  ctx.transcript.sessionTokens = undefined;
  assert.equal(renderCacheHitRateLine(ctx), null);
});

test('renderCacheHitRateLine is hidden when the session has no input activity', () => {
  const ctx = baseContext();
  ctx.transcript.sessionTokens = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
  assert.equal(renderCacheHitRateLine(ctx), null);
});

test('renderCacheHitRateLine uses input_tokens in the denominator', () => {
  // This is the regression that motivated the rewrite: the original formula
  // was `read / (read + created)`, so any session whose cache was pre-warmed
  // in a prior transcript window collapsed to 100%. Including inputTokens
  // (non-cached input) in the denominator keeps the rate bounded.
  const ctx = baseContext();
  ctx.transcript.sessionTokens = {
    inputTokens: 375_000,
    outputTokens: 38_000,
    cacheCreationTokens: 0,
    cacheReadTokens: 15_800_000,
  };
  // 15.8M / (375k + 15.8M) = 97.7%
  assert.equal(
    stripAnsi(renderCacheHitRateLine(ctx) ?? ''),
    'Cache hit 97.7%',
  );
});

test('renderCacheHitRateLine reflects cache writes in the denominator', () => {
  // When this session wrote new cache, the hit rate reflects that work in
  // the denominator — the user can correlate against the Tokens line.
  const ctx = baseContext();
  ctx.transcript.sessionTokens = {
    inputTokens: 100,
    outputTokens: 0,
    cacheCreationTokens: 50_000,
    cacheReadTokens: 50_000,
  };
  // 50k / (100 + 50k + 50k) = 50%
  assert.equal(
    stripAnsi(renderCacheHitRateLine(ctx) ?? ''),
    'Cache hit 50.0%',
  );
});

test('renderCacheHitRateLine reports 100% when all input came from cache', () => {
  // The only legitimate 100%: this session sent no non-cached input and
  // wrote no new cache — every input token was a cache hit.
  const ctx = baseContext();
  ctx.transcript.sessionTokens = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 50_000 };
  assert.equal(
    stripAnsi(renderCacheHitRateLine(ctx) ?? ''),
    'Cache hit 100.0%',
  );
});

test('renderCacheHitRateLine reports 0% when no cache activity', () => {
  const ctx = baseContext();
  ctx.transcript.sessionTokens = { inputTokens: 10_000, outputTokens: 5_000, cacheCreationTokens: 0, cacheReadTokens: 0 };
  assert.equal(
    stripAnsi(renderCacheHitRateLine(ctx) ?? ''),
    'Cache hit 0.0%',
  );
});

test('renderCacheHitRateLine clamps negative transcript values to zero', () => {
  // Defensive: malformed transcripts should not render a negative percent.
  const ctx = baseContext();
  ctx.transcript.sessionTokens = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: -10, cacheReadTokens: 50 };
  assert.equal(
    stripAnsi(renderCacheHitRateLine(ctx) ?? ''),
    'Cache hit 100.0%',
  );
});

test('renderCacheHitRateLine localizes the label to Simplified Chinese', () => {
  const ctx = baseContext();
  ctx.transcript.sessionTokens = { inputTokens: 200, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 50_000 };
  setLanguage('zh');
  try {
    assert.equal(
      stripAnsi(renderCacheHitRateLine(ctx) ?? ''),
      '缓存命中 99.6%',
    );
  } finally {
    setLanguage('en');
  }
});