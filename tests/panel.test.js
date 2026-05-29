import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { renderPanelLine } from '../dist/render/lines/panel.js';
import { mergeConfig, DEFAULT_CONFIG } from '../dist/config.js';

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
}

function ctxWith(panel) {
  return { config: mergeConfig({ panel }) };
}

test('panel is disabled by default and renders nothing', () => {
  assert.equal(DEFAULT_CONFIG.panel.enabled, false);
  assert.equal(renderPanelLine({ config: DEFAULT_CONFIG }), null);
});

test('panel renders nothing when enabled but unconfigured', () => {
  assert.equal(renderPanelLine(ctxWith({ enabled: true })), null);
});

test('panel renders brand + chips from cache file', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'panel-'));
  try {
    const cache = path.join(dir, 'chips');
    await writeFile(cache, 'A 1|B 2|C 3');
    const out = renderPanelLine(ctxWith({ enabled: true, brand: 'HUD', cacheFile: cache }));
    const plain = stripAnsi(out);
    assert.match(plain, /HUD/);
    assert.match(plain, /A 1/);
    assert.match(plain, /B 2/);
    assert.match(plain, /C 3/);
    // chips joined by a separator, single line for the brand row
    assert.equal(plain.split('\n')[0].includes('A 1'), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('panel hides a calendar headline once its TTL has expired', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'panel-'));
  try {
    const cal = path.join(dir, 'cal');
    await writeFile(cal, '100|past event'); // unix 100 → long expired
    const out = renderPanelLine(ctxWith({ enabled: true, calendarCacheFile: cal }));
    assert.equal(out, null, 'expired headline should not render');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('panel shows a calendar headline with a future TTL', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'panel-'));
  try {
    const cal = path.join(dir, 'cal');
    const future = Math.floor(Date.now() / 1000) + 3600;
    await writeFile(cal, `${future}|next event`);
    const out = stripAnsi(renderPanelLine(ctxWith({ enabled: true, calendarCacheFile: cal })));
    assert.match(out, /next event/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('panel TTL is backward-compatible with plain (non-prefixed) text', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'panel-'));
  try {
    const cal = path.join(dir, 'cal');
    await writeFile(cal, 'just a label');
    const out = stripAnsi(renderPanelLine(ctxWith({ enabled: true, calendarCacheFile: cal })));
    assert.match(out, /just a label/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("mergeConfig keeps 'panel' as a valid elementOrder entry", () => {
  const merged = mergeConfig({ elementOrder: ['project', 'panel', 'context'] });
  assert.deepEqual(merged.elementOrder, ['project', 'panel', 'context']);
});

test('mergeConfig validates panel fields and falls back on bad input', () => {
  const merged = mergeConfig({
    panel: { enabled: true, brand: 'X', brandColor: 'not-a-color', cacheFile: 42, showVitals: 'nope' },
  });
  assert.equal(merged.panel.enabled, true);
  assert.equal(merged.panel.brand, 'X');
  assert.equal(merged.panel.brandColor, DEFAULT_CONFIG.panel.brandColor); // invalid → fallback
  assert.equal(merged.panel.cacheFile, ''); // non-string → empty
  assert.equal(merged.panel.showVitals, DEFAULT_CONFIG.panel.showVitals); // invalid → fallback
});
