import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { getScopedUsage, parseScopedLimits, refreshScopedUsage } from '../dist/scoped-usage.js';

async function withTempDir() {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-scoped-usage-'));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

function cacheJson(updatedAt, windows) {
  return JSON.stringify({ updated_at: updatedAt, windows });
}

const FABLE_WINDOW = { label: 'Fable', percent: 38, resets_at: '2026-07-21T06:00:00.000Z' };

// ── getScopedUsage — cache reading ──

test('getScopedUsage returns windows from a fresh cache', async () => {
  const { dir, cleanup } = await withTempDir();
  try {
    const now = Date.now();
    await writeFile(path.join(dir, 'cache.json'), cacheJson(now, [FABLE_WINDOW]));

    const windows = getScopedUsage(now, { cacheDir: dir, triggerRefresh: false });

    assert.equal(windows.length, 1);
    assert.equal(windows[0].label, 'Fable');
    assert.equal(windows[0].percent, 38);
    assert.equal(windows[0].resetAt.toISOString(), '2026-07-21T06:00:00.000Z');
  } finally {
    await cleanup();
  }
});

test('getScopedUsage returns empty when there is no cache', async () => {
  const { dir, cleanup } = await withTempDir();
  try {
    assert.deepEqual(getScopedUsage(Date.now(), { cacheDir: dir, triggerRefresh: false }), []);
  } finally {
    await cleanup();
  }
});

test('getScopedUsage serves stale data within the max age (stale-while-revalidate)', async () => {
  const { dir, cleanup } = await withTempDir();
  try {
    const now = Date.now();
    // 10 minutes old: past the 5m TTL but well within the 1h max age.
    await writeFile(path.join(dir, 'cache.json'), cacheJson(now - 10 * 60 * 1000, [FABLE_WINDOW]));

    const windows = getScopedUsage(now, { cacheDir: dir, triggerRefresh: false });

    assert.equal(windows.length, 1);
  } finally {
    await cleanup();
  }
});

test('getScopedUsage hides data older than the max age', async () => {
  const { dir, cleanup } = await withTempDir();
  try {
    const now = Date.now();
    await writeFile(path.join(dir, 'cache.json'), cacheJson(now - 2 * 60 * 60 * 1000, [FABLE_WINDOW]));

    assert.deepEqual(getScopedUsage(now, { cacheDir: dir, triggerRefresh: false }), []);
  } finally {
    await cleanup();
  }
});

test('getScopedUsage tolerates malformed cache content', async () => {
  const { dir, cleanup } = await withTempDir();
  try {
    await writeFile(path.join(dir, 'cache.json'), 'not json');
    assert.deepEqual(getScopedUsage(Date.now(), { cacheDir: dir, triggerRefresh: false }), []);

    await writeFile(path.join(dir, 'cache.json'), cacheJson(Date.now(), [{ label: '', percent: 'x' }]));
    assert.deepEqual(getScopedUsage(Date.now(), { cacheDir: dir, triggerRefresh: false }), []);
  } finally {
    await cleanup();
  }
});

test('getScopedUsage clamps percent into 0-100', async () => {
  const { dir, cleanup } = await withTempDir();
  try {
    const now = Date.now();
    await writeFile(
      path.join(dir, 'cache.json'),
      cacheJson(now, [
        { label: 'Fable', percent: 140, resets_at: null },
        { label: 'Other', percent: -5, resets_at: null },
      ]),
    );

    const windows = getScopedUsage(now, { cacheDir: dir, triggerRefresh: false });

    assert.equal(windows[0].percent, 100);
    assert.equal(windows[1].percent, 0);
    assert.equal(windows[0].resetAt, null);
  } finally {
    await cleanup();
  }
});

// ── parseScopedLimits — OAuth usage API response extraction ──

test('parseScopedLimits extracts weekly_scoped model windows only', () => {
  const body = {
    limits: [
      { kind: 'session', percent: 33, resets_at: '2026-07-15T11:30:00Z', scope: null },
      { kind: 'weekly_all', percent: 21, resets_at: '2026-07-21T06:00:00Z', scope: null },
      {
        kind: 'weekly_scoped',
        percent: 38,
        resets_at: '2026-07-21T06:00:00Z',
        scope: { model: { id: null, display_name: 'Fable' }, surface: null },
      },
    ],
  };

  const windows = parseScopedLimits(body);

  assert.deepEqual(windows, [
    { label: 'Fable', percent: 38, resets_at: '2026-07-21T06:00:00Z' },
  ]);
});

test('parseScopedLimits skips scoped entries without a model display name or percent', () => {
  const body = {
    limits: [
      { kind: 'weekly_scoped', percent: 12, scope: { model: { display_name: null } } },
      { kind: 'weekly_scoped', percent: null, scope: { model: { display_name: 'Fable' } } },
      { kind: 'weekly_scoped', percent: 12, scope: { surface: 'cowork' } },
    ],
  };

  assert.deepEqual(parseScopedLimits(body), []);
});

test('parseScopedLimits tolerates missing or malformed bodies', () => {
  assert.deepEqual(parseScopedLimits(null), []);
  assert.deepEqual(parseScopedLimits({}), []);
  assert.deepEqual(parseScopedLimits({ limits: 'nope' }), []);
});

// ── refreshScopedUsage — cache writing (fetch/token injected) ──

test('refreshScopedUsage writes parsed windows to the cache file', async () => {
  const { dir, cleanup } = await withTempDir();
  try {
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({
        limits: [
          {
            kind: 'weekly_scoped',
            percent: 38,
            resets_at: '2026-07-21T06:00:00Z',
            scope: { model: { display_name: 'Fable' } },
          },
        ],
      }),
    });

    await refreshScopedUsage({ cacheDir: dir, token: 'test-token', fetchImpl });

    const cache = JSON.parse(await readFile(path.join(dir, 'cache.json'), 'utf8'));
    assert.equal(typeof cache.updated_at, 'number');
    assert.deepEqual(cache.windows, [
      { label: 'Fable', percent: 38, resets_at: '2026-07-21T06:00:00Z' },
    ]);
  } finally {
    await cleanup();
  }
});

test('refreshScopedUsage does nothing without a token', async () => {
  const { dir, cleanup } = await withTempDir();
  try {
    let called = false;
    await refreshScopedUsage({
      cacheDir: dir,
      token: null,
      fetchImpl: async () => {
        called = true;
        return { ok: true, json: async () => ({}) };
      },
    });

    assert.equal(called, false);
    await assert.rejects(readFile(path.join(dir, 'cache.json'), 'utf8'));
  } finally {
    await cleanup();
  }
});

test('refreshScopedUsage keeps the previous cache when the API fails', async () => {
  const { dir, cleanup } = await withTempDir();
  try {
    const before = cacheJson(123, [FABLE_WINDOW]);
    await writeFile(path.join(dir, 'cache.json'), before);

    await refreshScopedUsage({ cacheDir: dir, token: 't', fetchImpl: async () => ({ ok: false }) });
    assert.equal(await readFile(path.join(dir, 'cache.json'), 'utf8'), before);

    await refreshScopedUsage({
      cacheDir: dir,
      token: 't',
      fetchImpl: async () => {
        throw new Error('network down');
      },
    });
    assert.equal(await readFile(path.join(dir, 'cache.json'), 'utf8'), before);
  } finally {
    await cleanup();
  }
});
