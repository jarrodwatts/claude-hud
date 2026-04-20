import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_CONFIG } from '../dist/config.js';
import { getUsageFromExternalSnapshot } from '../dist/external-usage.js';

async function withTempFile(content) {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-external-usage-'));
  const filePath = path.join(dir, 'usage.json');
  await writeFile(filePath, content, 'utf8');
  return {
    filePath,
    cleanup: async () => rm(dir, { recursive: true, force: true }),
  };
}

function makeConfig(filePath, freshnessMs = 300000) {
  return {
    ...DEFAULT_CONFIG,
    display: {
      ...DEFAULT_CONFIG.display,
      externalUsagePath: filePath,
      externalUsageFreshnessMs: freshnessMs,
    },
  };
}

test('getUsageFromExternalSnapshot returns null without a configured path', () => {
  const usage = getUsageFromExternalSnapshot(DEFAULT_CONFIG, Date.now());
  assert.equal(usage, null);
});

test('getUsageFromExternalSnapshot parses a fresh snapshot', async () => {
  const updatedAt = Date.UTC(2026, 3, 20, 12, 0, 0);
  const resetAt = '2026-04-20T15:00:00.000Z';
  const { filePath, cleanup } = await withTempFile(JSON.stringify({
    updated_at: new Date(updatedAt).toISOString(),
    five_hour: { used_percentage: 42.4, resets_at: resetAt },
    seven_day: { used_percentage: 84.6, resets_at: '2026-04-27T12:00:00.000Z' },
  }));

  try {
    const usage = getUsageFromExternalSnapshot(makeConfig(filePath), updatedAt + 60_000);
    assert.deepEqual(usage, {
      fiveHour: 42,
      sevenDay: 85,
      fiveHourResetAt: new Date(resetAt),
      sevenDayResetAt: new Date('2026-04-27T12:00:00.000Z'),
    });
  } finally {
    await cleanup();
  }
});

test('getUsageFromExternalSnapshot ignores stale snapshots', async () => {
  const updatedAt = Date.UTC(2026, 3, 20, 12, 0, 0);
  const { filePath, cleanup } = await withTempFile(JSON.stringify({
    updated_at: new Date(updatedAt).toISOString(),
    five_hour: { used_percentage: 42, resets_at: '2026-04-20T15:00:00.000Z' },
  }));

  try {
    const usage = getUsageFromExternalSnapshot(makeConfig(filePath, 1000), updatedAt + 1001);
    assert.equal(usage, null);
  } finally {
    await cleanup();
  }
});

test('getUsageFromExternalSnapshot rejects invalid schema data', async () => {
  const updatedAt = Date.UTC(2026, 3, 20, 12, 0, 0);
  const { filePath, cleanup } = await withTempFile(JSON.stringify({
    updated_at: new Date(updatedAt).toISOString(),
    five_hour: { used_percentage: 42, resets_at: 'not-a-date' },
  }));

  try {
    const usage = getUsageFromExternalSnapshot(makeConfig(filePath), updatedAt + 1);
    assert.equal(usage, null);
  } finally {
    await cleanup();
  }
});

test('getUsageFromExternalSnapshot returns null for invalid JSON', async () => {
  const { filePath, cleanup } = await withTempFile('{');

  try {
    const usage = getUsageFromExternalSnapshot(makeConfig(filePath), Date.now());
    assert.equal(usage, null);
  } finally {
    await cleanup();
  }
});
