import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promptCacheLine } from '../dist/render/lines.js';
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
    now: NOW,
  };
}
const warm = (secondsLeft, ttl = '5m') => ({ caching_observed: true, warm: true, ttl, expires_at: NOW / 1000 + secondsLeft });

test('the prompt cache line is hidden when off, absent, or caching was never observed', () => {
  assert.equal(promptCacheLine(ctx(warm(200), { showPromptCache: false })), null);
  assert.equal(promptCacheLine(ctx(undefined)), null);
  assert.equal(promptCacheLine(ctx({ caching_observed: false })), null);
});

test('the prompt cache line shows the expiry time and warns near the end of the TTL', () => {
  const active = promptCacheLine(ctx(warm(240)));
  assert.equal(strip(active), `Cache ⏱ until ${clock(240)}`);
  const warning = promptCacheLine(ctx(warm(30)));
  assert.equal(strip(warning), `Cache ⏱ until ${clock(30)}`);
  assert.notEqual(active, warning, 'the last fifth of the TTL is coloured as a warning');
  assert.equal(strip(promptCacheLine(ctx(warm(600, '1h'), { showClockSeconds: true }))), `Cache ⏱ until ${clock(600, true)}`);
});

test('the prompt cache line reads expired once cold or past expires_at', () => {
  assert.equal(strip(promptCacheLine(ctx(warm(-1)))), 'Cache ⏱ expired');
  assert.equal(strip(promptCacheLine(ctx({ ...warm(200), warm: false }))), 'Cache ⏱ expired');
  setLanguage('zh-Hans');
  try {
    assert.equal(strip(promptCacheLine(ctx(warm(-1)))), '缓存 ⏱ 已过期');
  } finally {
    setLanguage('en');
  }
});
