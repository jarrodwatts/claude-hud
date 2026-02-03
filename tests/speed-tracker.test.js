import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
