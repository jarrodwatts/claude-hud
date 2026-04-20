import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPromptCacheCountdown, renderPromptCacheLine } from '../dist/render/lines/prompt-cache.js';
import { setLanguage } from '../dist/i18n/index.js';

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function baseContext() {
  return {
    stdin: {},
    transcript: { tools: [], agents: [], todos: [] },
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
        showPromptCache: true,
        promptCacheTtlSeconds: 300,
      },
      colors: {},
    },
    extraLabel: null,
  };
}

test('formatPromptCacheCountdown formats minutes and seconds', () => {
  assert.equal(formatPromptCacheCountdown(272_000), '4m 32s');
});

test('formatPromptCacheCountdown formats hours when needed', () => {
  assert.equal(formatPromptCacheCountdown(3_632_000), '1h 0m 32s');
});

test('formatPromptCacheCountdown returns expired when countdown has elapsed', () => {
  assert.equal(formatPromptCacheCountdown(0), 'expired');
  assert.equal(formatPromptCacheCountdown(-1000), 'expired');
});

test('renderPromptCacheLine shows warning and expired states', () => {
  const ctx = baseContext();
  const now = Date.UTC(2024, 0, 1, 0, 5, 0);

  ctx.transcript.lastAssistantResponseAt = new Date(now - 280_000);
  assert.equal(stripAnsi(renderPromptCacheLine(ctx, now) ?? ''), 'Cache ⏱ 0m 20s');

  ctx.transcript.lastAssistantResponseAt = new Date(now - 301_000);
  assert.equal(stripAnsi(renderPromptCacheLine(ctx, now) ?? ''), 'Cache ⏱ expired');
});

test('renderPromptCacheLine localizes label and expired state', () => {
  const ctx = baseContext();
  const now = Date.UTC(2024, 0, 1, 0, 5, 1);
  ctx.transcript.lastAssistantResponseAt = new Date(now - 301_000);

  setLanguage('zh');
  try {
    assert.equal(stripAnsi(renderPromptCacheLine(ctx, now) ?? ''), '缓存 ⏱ 已过期');
  } finally {
    setLanguage('en');
  }
});
