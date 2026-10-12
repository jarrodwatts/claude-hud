import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getUsageCachePath, withLastKnownUsage } from '../dist/usage-cache.js';

const NOW = Date.parse('2026-10-01T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

async function withTempHome(run) {
  const home = await mkdtemp(path.join(tmpdir(), 'hud-usage-cache-'));
  try {
    return await run(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

function usage(overrides = {}) {
  return {
    fiveHour: 25,
    sevenDay: 41,
    fiveHourResetAt: new Date(NOW + 2 * HOUR),
    sevenDayResetAt: new Date(NOW + 3 * DAY),
    ...overrides,
  };
}

test('withLastKnownUsage passes stdin through and remembers it', async () => {
  await withTempHome(async (home) => {
    const first = withLastKnownUsage(usage(), NOW, home);
    assert.deepEqual(first, usage());

    const cache = JSON.parse(await readFile(getUsageCachePath(home), 'utf8'));
    assert.deepEqual(cache, {
      five_hour: { used_percentage: 25, resets_at: NOW + 2 * HOUR, saved_at: NOW },
      seven_day: { used_percentage: 41, resets_at: NOW + 3 * DAY, saved_at: NOW },
    });
  });
});

test('withLastKnownUsage fills a window stdin left out from the last one it sent', async () => {
  await withTempHome(async (home) => {
    withLastKnownUsage(usage(), NOW, home);

    const weeklyOnly = withLastKnownUsage(
      usage({ fiveHour: null, fiveHourResetAt: null, sevenDay: 43 }),
      NOW + 10 * 60 * 1000,
      home,
    );
    assert.deepEqual(weeklyOnly, usage({ sevenDay: 43 }));

    const fiveHourOnly = withLastKnownUsage(
      usage({ fiveHour: 30, sevenDay: null, sevenDayResetAt: null }),
      NOW + 20 * 60 * 1000,
      home,
    );
    assert.deepEqual(fiveHourOnly, usage({ fiveHour: 30, sevenDay: 43 }));
  });
});

test('withLastKnownUsage stands in when stdin has no rate limits at all', async () => {
  await withTempHome(async (home) => {
    withLastKnownUsage(usage(), NOW, home);
    assert.deepEqual(withLastKnownUsage(null, NOW + HOUR, home), usage());
  });
});

test('withLastKnownUsage drops a remembered window once it has reset', async () => {
  await withTempHome(async (home) => {
    withLastKnownUsage(usage(), NOW, home);

    const afterFiveHourReset = withLastKnownUsage(null, NOW + 2 * HOUR + 1, home);
    assert.deepEqual(afterFiveHourReset, usage({ fiveHour: null, fiveHourResetAt: null }));

    assert.equal(withLastKnownUsage(null, NOW + 3 * DAY + 1, home), null);
  });
});

test('withLastKnownUsage bounds a window without a reset time by its length', async () => {
  await withTempHome(async (home) => {
    withLastKnownUsage(usage({ fiveHourResetAt: null, sevenDayResetAt: null }), NOW, home);

    const inside = withLastKnownUsage(null, NOW + 5 * HOUR - 1, home);
    assert.deepEqual(inside, usage({ fiveHourResetAt: null, sevenDayResetAt: null }));

    const past = withLastKnownUsage(null, NOW + 5 * HOUR, home);
    assert.deepEqual(past, usage({ fiveHour: null, fiveHourResetAt: null, sevenDayResetAt: null }));
  });
});

test('withLastKnownUsage lets stdin win over the cache even when its reset time is past', async () => {
  await withTempHome(async (home) => {
    withLastKnownUsage(usage(), NOW, home);
    const stale = usage({ fiveHour: 7, fiveHourResetAt: new Date(NOW - 1) });
    assert.deepEqual(withLastKnownUsage(stale, NOW, home), stale);
  });
});

test('withLastKnownUsage rewrites the cache only when the values change', async () => {
  await withTempHome(async (home) => {
    const file = getUsageCachePath(home);
    withLastKnownUsage(usage(), NOW, home);
    const written = await readFile(file, 'utf8');

    withLastKnownUsage(usage(), NOW + HOUR, home);
    assert.equal(await readFile(file, 'utf8'), written);

    withLastKnownUsage(null, NOW + HOUR, home);
    assert.equal(await readFile(file, 'utf8'), written);

    withLastKnownUsage(usage({ fiveHour: 26 }), NOW + HOUR, home);
    assert.notEqual(await readFile(file, 'utf8'), written);
  });
});

test('withLastKnownUsage never writes when stdin carries no usage', async () => {
  await withTempHome(async (home) => {
    assert.equal(withLastKnownUsage(null, NOW, home), null);
    assert.equal(existsSync(getUsageCachePath(home)), false);
  });
});

test('withLastKnownUsage ignores a malformed or tampered cache', async () => {
  await withTempHome(async (home) => {
    const file = getUsageCachePath(home);
    await mkdir(path.dirname(file), { recursive: true });

    for (const content of [
      'not json',
      '[]',
      JSON.stringify({ five_hour: { used_percentage: 250, resets_at: NOW + HOUR, saved_at: NOW } }),
      JSON.stringify({ five_hour: { used_percentage: 25, resets_at: 'soon', saved_at: NOW } }),
      JSON.stringify({ five_hour: { used_percentage: 25, resets_at: NOW + HOUR } }),
    ]) {
      await writeFile(file, content, 'utf8');
      assert.equal(withLastKnownUsage(null, NOW, home), null, content);
    }
  });
});

test('the CLI keeps the 5h window on a refresh that only carries the weekly window', async () => {
  await withTempHome(async (home) => {
    const entry = fileURLToPath(new URL('../dist/index.js', import.meta.url));
    const now = Math.floor(Date.now() / 1000);
    const run = (rateLimits) => {
      const result = spawnSync(process.execPath, [entry], {
        input: JSON.stringify({
          model: { display_name: 'Opus' },
          context_window: { used_percentage: 12, context_window_size: 200_000 },
          rate_limits: rateLimits,
        }),
        encoding: 'utf8',
        env: { PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: path.join(home, '.claude'), COLUMNS: '120' },
      });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.replace(/\x1b\[[0-9;]*m/g, '');
    };

    const both = run({
      five_hour: { used_percentage: 25, resets_at: now + 5_400 },
      seven_day: { used_percentage: 41, resets_at: now + 3 * 86_400 },
    });
    assert.match(both, /Usage .*25%/);
    assert.doesNotMatch(both, /Weekly/);

    const weeklyOnly = run({ seven_day: { used_percentage: 41, resets_at: now + 3 * 86_400 } });
    assert.match(weeklyOnly, /Usage .*25%/);
    assert.doesNotMatch(weeklyOnly, /Weekly/);
  });
});
