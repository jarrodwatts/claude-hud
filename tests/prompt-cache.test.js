import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPromptCacheLine } from '../dist/render/lines/prompt-cache.js';
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

/**
 * Expected wall-clock rendering of `at`, derived the same way the renderer does
 * rather than hardcoded, so the assertions hold in any timezone or locale.
 */
function expectedClock(at, opts = {}) {
  const timeOpts = { hour: '2-digit', minute: '2-digit' };
  if (opts.showSeconds) timeOpts.second = '2-digit';
  if (opts.hourCycle) timeOpts.hourCycle = opts.hourCycle;
  return new Date(at).toLocaleTimeString([], timeOpts);
}

test('renderPromptCacheLine is hidden without an anchor', () => {
  const ctx = baseContext();
  assert.equal(renderPromptCacheLine(ctx, Date.now()), null);
});

test('renderPromptCacheLine is hidden when not enabled', () => {
  const ctx = baseContext();
  ctx.config.display.showPromptCache = false;
  ctx.transcript.promptCacheAnchorAt = new Date();
  assert.equal(renderPromptCacheLine(ctx, Date.now()), null);
});

test('renderPromptCacheLine shows the expiry time, not a countdown', () => {
  const ctx = baseContext();
  const now = Date.UTC(2024, 0, 1, 12, 0, 0);
  ctx.transcript.promptCacheAnchorAt = new Date(now - 60_000);

  const expiresAt = now - 60_000 + 300_000;
  assert.equal(
    stripAnsi(renderPromptCacheLine(ctx, now) ?? ''),
    `Cache ⏱ until ${expectedClock(expiresAt)}`,
  );
});

test('renderPromptCacheLine holds the same value as the render goes stale', () => {
  const ctx = baseContext();
  const anchor = Date.UTC(2024, 0, 1, 12, 0, 0);
  ctx.transcript.promptCacheAnchorAt = new Date(anchor);
  ctx.transcript.promptCacheTtlSeconds = 3600;

  // The point of an absolute time: three renders minutes apart, one value.
  const first = stripAnsi(renderPromptCacheLine(ctx, anchor + 60_000) ?? '');
  const later = stripAnsi(renderPromptCacheLine(ctx, anchor + 30 * 60_000) ?? '');
  const last = stripAnsi(renderPromptCacheLine(ctx, anchor + 59 * 60_000) ?? '');

  assert.equal(first, `Cache ⏱ until ${expectedClock(anchor + 3_600_000)}`);
  assert.equal(later, first);
  assert.equal(last, first);
});

test('renderPromptCacheLine prefers the detected TTL over the 5m default', () => {
  const ctx = baseContext();
  const now = Date.UTC(2024, 0, 1, 12, 0, 0);
  ctx.transcript.promptCacheAnchorAt = new Date(now - 10 * 60_000);

  // 10 minutes after the request: expired on the 5m tier, warm on the 1h tier.
  assert.equal(stripAnsi(renderPromptCacheLine(ctx, now) ?? ''), 'Cache ⏱ expired');

  ctx.transcript.promptCacheTtlSeconds = 3600;
  assert.equal(
    stripAnsi(renderPromptCacheLine(ctx, now) ?? ''),
    `Cache ⏱ until ${expectedClock(now - 10 * 60_000 + 3_600_000)}`,
  );
});

test('renderPromptCacheLine keeps the configured TTL as a detection fallback', () => {
  const ctx = baseContext();
  const now = Date.UTC(2024, 0, 1, 12, 0, 0);
  ctx.transcript.promptCacheAnchorAt = new Date(now - 10 * 60_000);
  ctx.config.display.promptCacheTtlSeconds = 3600;

  assert.equal(
    stripAnsi(renderPromptCacheLine(ctx, now) ?? ''),
    `Cache ⏱ until ${expectedClock(now - 10 * 60_000 + 3_600_000)}`,
  );

  ctx.transcript.promptCacheTtlSeconds = 300;
  assert.equal(stripAnsi(renderPromptCacheLine(ctx, now) ?? ''), 'Cache ⏱ expired');
});

test('renderPromptCacheLine ignores a TTL that is not a real tier', () => {
  const ctx = baseContext();
  const now = Date.UTC(2024, 0, 1, 12, 0, 0);
  ctx.transcript.promptCacheAnchorAt = new Date(now);
  ctx.transcript.promptCacheTtlSeconds = 86_400;

  // Falls back to 5m rather than counting down against a fabricated tier.
  assert.equal(
    stripAnsi(renderPromptCacheLine(ctx, now) ?? ''),
    `Cache ⏱ until ${expectedClock(now + 300_000)}`,
  );
});

test('renderPromptCacheLine reports expired once the TTL has elapsed', () => {
  const ctx = baseContext();
  const now = Date.UTC(2024, 0, 1, 12, 0, 0);

  ctx.transcript.promptCacheAnchorAt = new Date(now - 300_000);
  assert.equal(stripAnsi(renderPromptCacheLine(ctx, now) ?? ''), 'Cache ⏱ expired');

  ctx.transcript.promptCacheAnchorAt = new Date(now - 2 * 60 * 60_000);
  assert.equal(stripAnsi(renderPromptCacheLine(ctx, now) ?? ''), 'Cache ⏱ expired');
});

test('renderPromptCacheLine follows hourCycle and showClockSeconds', () => {
  const ctx = baseContext();
  const now = Date.UTC(2024, 0, 1, 12, 0, 0);
  ctx.transcript.promptCacheAnchorAt = new Date(now);
  ctx.config.display.hourCycle = 'h23';
  ctx.config.display.showClockSeconds = true;

  assert.equal(
    stripAnsi(renderPromptCacheLine(ctx, now) ?? ''),
    `Cache ⏱ until ${expectedClock(now + 300_000, { hourCycle: 'h23', showSeconds: true })}`,
  );
});

test('renderPromptCacheLine localizes label and expired state', () => {
  const ctx = baseContext();
  const now = Date.UTC(2024, 0, 1, 0, 5, 1);
  ctx.transcript.promptCacheAnchorAt = new Date(now - 301_000);

  setLanguage('zh');
  try {
    assert.equal(stripAnsi(renderPromptCacheLine(ctx, now) ?? ''), '缓存 ⏱ 已过期');
  } finally {
    setLanguage('en');
  }
});
