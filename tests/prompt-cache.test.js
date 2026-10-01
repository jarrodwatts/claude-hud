import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPromptCacheLine } from '../dist/render/lines/prompt-cache.js';
import { setLanguage } from '../dist/i18n/index.js';

const NOW = Date.UTC(2026, 9, 1, 12, 0, 0);
const strip = (s) => s?.replace(/\x1b\[[0-9;]*m/g, '');
const pad = (n) => String(n).padStart(2, '0');
const clock = (secondsFromNow, seconds = false) => {
  const d = new Date(NOW + secondsFromNow * 1000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}${seconds ? `:${pad(d.getSeconds())}` : ''}`;
};

function ctx(cache, display = {}) {
  return {
    stdin: { prompt_cache: cache },
    config: { display: { showPromptCache: true, hourCycle: 'h23', ...display }, colors: {} },
  };
}
const warm = (secondsLeft, ttl = '5m') => ({ caching_observed: true, warm: true, ttl, expires_at: NOW / 1000 + secondsLeft });

test('the prompt cache line is hidden when off, absent, or caching was never observed', () => {
  assert.equal(renderPromptCacheLine(ctx(warm(200), { showPromptCache: false }), NOW), null);
  assert.equal(renderPromptCacheLine(ctx(undefined), NOW), null);
  assert.equal(renderPromptCacheLine(ctx({ caching_observed: false }), NOW), null);
});

test('the prompt cache line shows the expiry time and warns near the end of the TTL', () => {
  const active = renderPromptCacheLine(ctx(warm(240)), NOW);
  assert.equal(strip(active), `Cache ⏱ until ${clock(240)}`);
  const warning = renderPromptCacheLine(ctx(warm(30)), NOW);
  assert.equal(strip(warning), `Cache ⏱ until ${clock(30)}`);
  assert.notEqual(active, warning, 'the last fifth of the TTL is coloured as a warning');
  assert.equal(strip(renderPromptCacheLine(ctx(warm(600, '1h'), { showClockSeconds: true }), NOW)), `Cache ⏱ until ${clock(600, true)}`);
});

test('the prompt cache line reads expired once cold or past expires_at', () => {
  assert.equal(strip(renderPromptCacheLine(ctx(warm(-1)), NOW)), 'Cache ⏱ expired');
  assert.equal(strip(renderPromptCacheLine(ctx({ ...warm(200), warm: false }), NOW)), 'Cache ⏱ expired');
  setLanguage('zh-Hans');
  try {
    assert.equal(strip(renderPromptCacheLine(ctx(warm(-1)), NOW)), '缓存 ⏱ 已过期');
  } finally {
    setLanguage('en');
  }
});
