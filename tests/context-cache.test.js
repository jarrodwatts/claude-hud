import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile, utimes } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  applyContextWindowFallback,
  _sweepCacheForTests,
} from '../dist/context-cache.js';

async function createTempHome() {
  return await mkdtemp(path.join(tmpdir(), 'claude-hud-context-'));
}

function getCacheDir(homeDir) {
  return path.join(homeDir, '.claude', 'plugins', 'claude-hud', 'context-cache');
}

function getCachePath(homeDir, transcriptPath) {
  const hash = createHash('sha256').update(path.resolve(transcriptPath)).digest('hex');
  return path.join(getCacheDir(homeDir), `${hash}.json`);
}

function makeSuspiciousFrame(overrides = {}) {
  return {
    transcript_path: '/tmp/session-a.jsonl',
    context_window: {
      context_window_size: 200000,
      total_input_tokens: 250000,
      used_percentage: 0,
      remaining_percentage: 100,
      current_usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      ...overrides,
    },
  };
}

function makeHealthyFrame(transcriptPath, overrides = {}) {
  return {
    transcript_path: transcriptPath,
    context_window: {
      context_window_size: 200000,
      total_input_tokens: 120000,
      used_percentage: 58,
      remaining_percentage: 42,
      current_usage: {
        input_tokens: 110000,
        output_tokens: 4000,
        cache_creation_input_tokens: 1200,
        cache_read_input_tokens: 800,
      },
      ...overrides,
    },
  };
}

/**
 * Default test deps: fixed homeDir + fixed now + random that never triggers sweep.
 * Sweep logic is verified separately via `_sweepCacheForTests`.
 */
function makeDeps(homeDir, now = 1_000_000) {
  return { homeDir: () => homeDir, now: () => now, random: () => 1 };
}

test('applyContextWindowFallback applies cached context for suspicious zero frames', async () => {
  const tempHome = await createTempHome();

  try {
    const transcriptPath = '/tmp/session-a.jsonl';
    const cachePath = getCachePath(tempHome, transcriptPath);
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(
      cachePath,
      JSON.stringify({
        used_percentage: 61,
        remaining_percentage: 39,
        context_window_size: 200000,
        current_usage: {
          input_tokens: 120000,
          output_tokens: 5000,
          cache_creation_input_tokens: 1000,
          cache_read_input_tokens: 800,
        },
        saved_at: 999_000,
      }),
      'utf8',
    );

    const stdin = makeSuspiciousFrame();
    stdin.transcript_path = transcriptPath;

    applyContextWindowFallback(stdin, makeDeps(tempHome));

    assert.equal(stdin.context_window.used_percentage, 61);
    assert.equal(stdin.context_window.remaining_percentage, 39);
    assert.deepEqual(stdin.context_window.current_usage, {
      input_tokens: 120000,
      output_tokens: 5000,
      cache_creation_input_tokens: 1000,
      cache_read_input_tokens: 800,
    });
    assert.equal(stdin.context_window.context_window_size, 200000);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('applyContextWindowFallback keeps suspicious frame unchanged when cache is missing', async () => {
  const tempHome = await createTempHome();

  try {
    const stdin = makeSuspiciousFrame();

    applyContextWindowFallback(stdin, makeDeps(tempHome));

    assert.equal(stdin.context_window.used_percentage, 0);
    assert.equal(stdin.context_window.remaining_percentage, 100);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('applyContextWindowFallback writes cache for good context frames', async () => {
  const tempHome = await createTempHome();
  const transcriptPath = '/tmp/session-a.jsonl';

  try {
    const stdin = makeHealthyFrame(transcriptPath);

    applyContextWindowFallback(stdin, makeDeps(tempHome, 1_000_000));

    const cachePath = getCachePath(tempHome, transcriptPath);
    assert.equal(existsSync(cachePath), true);
    const cacheContent = JSON.parse(await readFile(cachePath, 'utf8'));
    assert.equal(cacheContent.used_percentage, 58);
    assert.equal(cacheContent.remaining_percentage, 42);
    assert.equal(cacheContent.context_window_size, 200000);
    assert.deepEqual(cacheContent.current_usage, stdin.context_window.current_usage);
    assert.equal(cacheContent.saved_at, 1_000_000);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('applyContextWindowFallback ignores corrupted cache without throwing', async () => {
  const tempHome = await createTempHome();
  const transcriptPath = '/tmp/session-a.jsonl';

  try {
    const cachePath = getCachePath(tempHome, transcriptPath);
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cachePath, '{not-json', 'utf8');

    const stdin = makeSuspiciousFrame();
    stdin.transcript_path = transcriptPath;

    assert.doesNotThrow(() => {
      applyContextWindowFallback(stdin, makeDeps(tempHome));
    });
    assert.equal(stdin.context_window.used_percentage, 0);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('applyContextWindowFallback does not restore cache when zero frame has not overflowed the context window', async () => {
  const tempHome = await createTempHome();
  const transcriptPath = '/tmp/session-a.jsonl';

  try {
    const cachePath = getCachePath(tempHome, transcriptPath);
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(
      cachePath,
      JSON.stringify({
        used_percentage: 61,
        remaining_percentage: 39,
        context_window_size: 200000,
        current_usage: {
          input_tokens: 120000,
          output_tokens: 5000,
          cache_creation_input_tokens: 1000,
          cache_read_input_tokens: 800,
        },
        saved_at: 999_000,
      }),
      'utf8',
    );

    const stdin = makeSuspiciousFrame({ total_input_tokens: 200000 });
    stdin.transcript_path = transcriptPath;

    applyContextWindowFallback(stdin, makeDeps(tempHome));

    assert.equal(stdin.context_window.used_percentage, 0);
    assert.equal(stdin.context_window.remaining_percentage, 100);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('applyContextWindowFallback safely returns when context_window is missing', () => {
  assert.doesNotThrow(() => {
    applyContextWindowFallback({ transcript_path: '/tmp/x.jsonl' }, makeDeps('/tmp/unused'));
  });
});

test('applyContextWindowFallback is a no-op when transcript_path is missing', async () => {
  const tempHome = await createTempHome();

  try {
    const stdin = makeHealthyFrame(undefined);
    delete stdin.transcript_path;

    applyContextWindowFallback(stdin, makeDeps(tempHome));

    assert.equal(existsSync(getCacheDir(tempHome)), false);
    assert.equal(stdin.context_window.used_percentage, 58);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('applyContextWindowFallback isolates cache between concurrent sessions', async () => {
  const tempHome = await createTempHome();
  const sessionA = '/tmp/session-a.jsonl';
  const sessionB = '/tmp/session-b.jsonl';

  try {
    applyContextWindowFallback(makeHealthyFrame(sessionA), makeDeps(tempHome, 1_000_000));

    const healthyB = makeHealthyFrame(sessionB, {
      total_input_tokens: 60000,
      used_percentage: 17,
      remaining_percentage: 83,
      current_usage: {
        input_tokens: 40000,
        output_tokens: 1200,
        cache_creation_input_tokens: 300,
        cache_read_input_tokens: 100,
      },
    });
    applyContextWindowFallback(healthyB, makeDeps(tempHome, 1_000_001));

    const cacheA = JSON.parse(await readFile(getCachePath(tempHome, sessionA), 'utf8'));
    const cacheB = JSON.parse(await readFile(getCachePath(tempHome, sessionB), 'utf8'));
    assert.equal(cacheA.used_percentage, 58);
    assert.equal(cacheB.used_percentage, 17);

    const suspiciousB = makeSuspiciousFrame();
    suspiciousB.transcript_path = sessionB;
    applyContextWindowFallback(suspiciousB, makeDeps(tempHome, 1_000_002));

    assert.equal(suspiciousB.context_window.used_percentage, 17);
    assert.equal(suspiciousB.context_window.remaining_percentage, 83);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('applyContextWindowFallback skips write when cache is fresh within TTL', async () => {
  const tempHome = await createTempHome();
  const transcriptPath = '/tmp/session-a.jsonl';

  try {
    applyContextWindowFallback(makeHealthyFrame(transcriptPath), makeDeps(tempHome, 1_000_000));

    const first = JSON.parse(await readFile(getCachePath(tempHome, transcriptPath), 'utf8'));
    assert.equal(first.saved_at, 1_000_000);

    applyContextWindowFallback(makeHealthyFrame(transcriptPath), makeDeps(tempHome, 1_002_000));

    const second = JSON.parse(await readFile(getCachePath(tempHome, transcriptPath), 'utf8'));
    assert.equal(second.saved_at, 1_000_000, 'saved_at must not advance within TTL when value is unchanged');
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('applyContextWindowFallback rewrites cache after TTL elapses even with unchanged value', async () => {
  const tempHome = await createTempHome();
  const transcriptPath = '/tmp/session-a.jsonl';

  try {
    applyContextWindowFallback(makeHealthyFrame(transcriptPath), makeDeps(tempHome, 1_000_000));
    applyContextWindowFallback(makeHealthyFrame(transcriptPath), makeDeps(tempHome, 1_015_000));

    const refreshed = JSON.parse(await readFile(getCachePath(tempHome, transcriptPath), 'utf8'));
    assert.equal(refreshed.saved_at, 1_015_000);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('applyContextWindowFallback keeps the earlier snapshot when usage changes within TTL', async () => {
  const tempHome = await createTempHome();
  const transcriptPath = '/tmp/session-a.jsonl';

  try {
    applyContextWindowFallback(makeHealthyFrame(transcriptPath), makeDeps(tempHome, 1_000_000));

    const changed = makeHealthyFrame(transcriptPath, {
      used_percentage: 59,
      remaining_percentage: 41,
    });
    applyContextWindowFallback(changed, makeDeps(tempHome, 1_002_000));

    const refreshed = JSON.parse(await readFile(getCachePath(tempHome, transcriptPath), 'utf8'));
    assert.equal(refreshed.used_percentage, 58);
    assert.equal(refreshed.saved_at, 1_000_000);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('applyContextWindowFallback triggers sweep when random sample falls under the rate', async () => {
  const tempHome = await createTempHome();
  const transcriptPath = '/tmp/session-a.jsonl';
  const cacheDir = getCacheDir(tempHome);
  const now = 10_000_000_000;
  const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;

  try {
    await mkdir(cacheDir, { recursive: true });
    const stalePath = path.join(cacheDir, 'stale.json');
    await writeFile(stalePath, '{}', 'utf8');
    const staleTimeSec = (now - EIGHT_DAYS_MS) / 1000;
    await utimes(stalePath, staleTimeSec, staleTimeSec);

    applyContextWindowFallback(makeHealthyFrame(transcriptPath), {
      homeDir: () => tempHome,
      now: () => now,
      random: () => 0,
    });

    assert.equal(existsSync(stalePath), false, 'stale file should be removed by sweep');
    assert.equal(existsSync(getCachePath(tempHome, transcriptPath)), true, 'current session cache must survive');
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('_sweepCacheForTests removes entries older than the max age', async () => {
  const tempHome = await createTempHome();
  const cacheDir = getCacheDir(tempHome);
  const now = 10_000_000_000;
  const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;

  try {
    await mkdir(cacheDir, { recursive: true });
    const stalePath = path.join(cacheDir, 'stale.json');
    const freshPath = path.join(cacheDir, 'fresh.json');
    await writeFile(stalePath, '{}', 'utf8');
    await writeFile(freshPath, '{}', 'utf8');

    const staleTimeSec = (now - EIGHT_DAYS_MS) / 1000;
    await utimes(stalePath, staleTimeSec, staleTimeSec);
    const freshTimeSec = (now - 1000) / 1000;
    await utimes(freshPath, freshTimeSec, freshTimeSec);

    _sweepCacheForTests(tempHome, now);

    assert.equal(existsSync(stalePath), false);
    assert.equal(existsSync(freshPath), true);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('_sweepCacheForTests evicts oldest entries when over the entry cap', async () => {
  const tempHome = await createTempHome();
  const cacheDir = getCacheDir(tempHome);
  const now = 10_000_000_000;
  const TOTAL = 105;
  const CAP = 100;

  try {
    await mkdir(cacheDir, { recursive: true });

    for (let i = 0; i < TOTAL; i += 1) {
      const filePath = path.join(cacheDir, `entry-${i}.json`);
      await writeFile(filePath, '{}', 'utf8');
      const timeSec = (now - (TOTAL - i) * 1000) / 1000;
      await utimes(filePath, timeSec, timeSec);
    }

    _sweepCacheForTests(tempHome, now);

    for (let i = 0; i < TOTAL - CAP; i += 1) {
      assert.equal(existsSync(path.join(cacheDir, `entry-${i}.json`)), false, `entry-${i} should be evicted`);
    }
    for (let i = TOTAL - CAP; i < TOTAL; i += 1) {
      assert.equal(existsSync(path.join(cacheDir, `entry-${i}.json`)), true, `entry-${i} should survive`);
    }
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});
