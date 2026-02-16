import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as fs from 'node:fs';
import { getOutputSpeed } from '../dist/speed-tracker.js';

async function createTempHome() {
  return await mkdtemp(path.join(tmpdir(), 'claude-hud-speed-'));
}

test('getOutputSpeed returns null when output tokens are missing', () => {
  const speed = getOutputSpeed({ context_window: { current_usage: { input_tokens: 10 } } });
  assert.equal(speed, null);
});

test('getOutputSpeed computes tokens per second within window', async () => {
  const tempHome = await createTempHome();

  try {
    const base = { homeDir: () => tempHome };
    const first = getOutputSpeed(
      { context_window: { current_usage: { output_tokens: 10 } } },
      { ...base, now: () => 1000 }
    );
    assert.equal(first, null);

    const second = getOutputSpeed(
      { context_window: { current_usage: { output_tokens: 20 } } },
      { ...base, now: () => 1500 }
    );
    assert.ok(second !== null);
    assert.ok(Math.abs(second - 20) < 0.01);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('getOutputSpeed ignores stale windows', async () => {
  const tempHome = await createTempHome();

  try {
    const base = { homeDir: () => tempHome };
    getOutputSpeed(
      { context_window: { current_usage: { output_tokens: 10 } } },
      { ...base, now: () => 1000 }
    );

    const speed = getOutputSpeed(
      { context_window: { current_usage: { output_tokens: 30 } } },
      { ...base, now: () => 8000 }
    );
    assert.equal(speed, null);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('getOutputSpeed skips disk write when token count is unchanged', async () => {
  const tempHome = await createTempHome();

  try {
    const base = { homeDir: () => tempHome };
    const cachePath = path.join(tempHome, '.claude', 'plugins', 'claude-hud', '.speed-cache.json');

    // First call — creates the cache file
    getOutputSpeed(
      { context_window: { current_usage: { output_tokens: 50 } } },
      { ...base, now: () => 1000 }
    );
    assert.ok(fs.existsSync(cachePath), 'Cache file should exist after first call');
    const mtime1 = fs.statSync(cachePath).mtimeMs;

    // Small delay to ensure mtime would differ if a write occurs
    await new Promise((r) => setTimeout(r, 50));

    // Second call — same token count, different timestamp
    getOutputSpeed(
      { context_window: { current_usage: { output_tokens: 50 } } },
      { ...base, now: () => 1500 }
    );
    const mtime2 = fs.statSync(cachePath).mtimeMs;

    // Cache file should NOT have been rewritten (mtime unchanged)
    assert.equal(mtime1, mtime2, 'Cache should not be rewritten when token count is unchanged');
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('getOutputSpeed writes cache when token count changes', async () => {
  const tempHome = await createTempHome();

  try {
    const base = { homeDir: () => tempHome };
    const cachePath = path.join(tempHome, '.claude', 'plugins', 'claude-hud', '.speed-cache.json');

    // First call — creates cache
    getOutputSpeed(
      { context_window: { current_usage: { output_tokens: 50 } } },
      { ...base, now: () => 1000 }
    );
    const content1 = fs.readFileSync(cachePath, 'utf8');
    const cache1 = JSON.parse(content1);

    // Second call — different token count, should update cache
    getOutputSpeed(
      { context_window: { current_usage: { output_tokens: 60 } } },
      { ...base, now: () => 1500 }
    );
    const content2 = fs.readFileSync(cachePath, 'utf8');
    const cache2 = JSON.parse(content2);

    assert.equal(cache1.outputTokens, 50);
    assert.equal(cache2.outputTokens, 60, 'Cache should be updated with new token count');
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});
