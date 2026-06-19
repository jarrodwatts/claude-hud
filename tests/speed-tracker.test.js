import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getOutputSpeed } from '../dist/speed-tracker.js';
import { existsSync } from 'node:fs';

function restoreEnvVar(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

async function createTempHome() {
  return await mkdtemp(path.join(tmpdir(), 'claude-hud-speed-'));
}

async function createTranscript(tempHome, name = 'session.jsonl') {
  const transcriptPath = path.join(tempHome, name);
  await writeFile(transcriptPath, '', 'utf8');
  return transcriptPath;
}

function stdinWith(transcriptPath, outputTokens) {
  return {
    transcript_path: transcriptPath,
    context_window: { current_usage: { output_tokens: outputTokens } },
  };
}

test('getOutputSpeed returns null when output tokens are missing', () => {
  const speed = getOutputSpeed({
    transcript_path: '/tmp/claude-hud-speed-missing.jsonl',
    context_window: { current_usage: { input_tokens: 10 } },
  });
  assert.equal(speed, null);
});

test('getOutputSpeed estimates speed from transcript growth when output tokens are missing', async () => {
  const tempHome = await createTempHome();
  const transcriptPath = await createTranscript(tempHome);

  try {
    const base = { homeDir: () => tempHome };
    const first = getOutputSpeed(
      { transcript_path: transcriptPath, context_window: { current_usage: { input_tokens: 10 } } },
      { ...base, now: () => 1000 }
    );
    assert.equal(first, null);

    await writeFile(transcriptPath, 'x'.repeat(40), 'utf8');
    const second = getOutputSpeed(
      { transcript_path: transcriptPath, context_window: { current_usage: { input_tokens: 10 } } },
      { ...base, now: () => 1500 }
    );
    assert.ok(second !== null);
    assert.ok(Math.abs(second - 20) < 0.01);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('getOutputSpeed accumulates short transcript-growth windows until the fallback sample matures', async () => {
  const tempHome = await createTempHome();
  const transcriptPath = await createTranscript(tempHome);

  try {
    const base = { homeDir: () => tempHome };
    const stdin = { transcript_path: transcriptPath, context_window: { current_usage: { input_tokens: 10 } } };

    getOutputSpeed(stdin, { ...base, now: () => 1000 });

    await writeFile(transcriptPath, 'x'.repeat(40), 'utf8');
    assert.equal(getOutputSpeed(stdin, { ...base, now: () => 1200 }), null);

    await writeFile(transcriptPath, 'x'.repeat(80), 'utf8');
    assert.equal(getOutputSpeed(stdin, { ...base, now: () => 1400 }), null);

    await writeFile(transcriptPath, 'x'.repeat(120), 'utf8');
    const matured = getOutputSpeed(stdin, { ...base, now: () => 1600 });
    assert.ok(matured !== null);
    assert.ok(Math.abs(matured - 50) < 0.01);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('getOutputSpeed ignores fallback samples without transcript growth', async () => {
  const tempHome = await createTempHome();
  const transcriptPath = await createTranscript(tempHome);

  try {
    const base = { homeDir: () => tempHome };
    const stdin = { transcript_path: transcriptPath, context_window: { current_usage: { input_tokens: 10 } } };

    getOutputSpeed(stdin, { ...base, now: () => 1000 });
    const idle = getOutputSpeed(stdin, { ...base, now: () => 1500 });
    assert.equal(idle, null);

    await writeFile(transcriptPath, 'x'.repeat(40), 'utf8');
    const afterIdle = getOutputSpeed(stdin, { ...base, now: () => 2000 });
    assert.ok(afterIdle !== null);
    assert.ok(Math.abs(afterIdle - 20) < 0.01);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('getOutputSpeed ignores stale fallback windows', async () => {
  const tempHome = await createTempHome();
  const transcriptPath = await createTranscript(tempHome);

  try {
    const base = { homeDir: () => tempHome };
    const stdin = { transcript_path: transcriptPath, context_window: { current_usage: { input_tokens: 10 } } };

    getOutputSpeed(stdin, { ...base, now: () => 1000 });

    await writeFile(transcriptPath, 'x'.repeat(40), 'utf8');
    const stale = getOutputSpeed(stdin, { ...base, now: () => 8000 });
    assert.equal(stale, null);

    await writeFile(transcriptPath, 'x'.repeat(80), 'utf8');
    const fresh = getOutputSpeed(stdin, { ...base, now: () => 8500 });
    assert.ok(fresh !== null);
    assert.ok(Math.abs(fresh - 20) < 0.01);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('getOutputSpeed creates fallback cache under CLAUDE_CONFIG_DIR by default', async () => {
  const tempHome = await createTempHome();
  const customConfigDir = path.join(tempHome, '.claude-alt');
  const originalHome = process.env.HOME;
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.HOME = tempHome;
  process.env.CLAUDE_CONFIG_DIR = customConfigDir;

  try {
    const transcriptPath = await createTranscript(tempHome);
    const speed = getOutputSpeed(
      { transcript_path: transcriptPath, context_window: { current_usage: { input_tokens: 10 } } },
      { now: () => 1000 }
    );
    assert.equal(speed, null);

    const customCacheDir = path.join(customConfigDir, 'plugins', 'claude-hud', 'speed-cache');
    const defaultCacheDir = path.join(tempHome, '.claude', 'plugins', 'claude-hud', 'speed-cache');
    assert.equal(existsSync(customCacheDir), true);
    assert.equal(existsSync(defaultCacheDir), false);
    assert.equal((await stat(customCacheDir)).mode & 0o777, 0o700);

    const cacheFiles = await readdir(customCacheDir);
    const fileSizeCache = cacheFiles.find((name) => name.endsWith('.json.fs'));
    assert.ok(fileSizeCache, `expected file-size cache in ${cacheFiles.join(', ')}`);
    assert.equal((await stat(path.join(customCacheDir, fileSizeCache))).mode & 0o777, 0o600);
  } finally {
    restoreEnvVar('HOME', originalHome);
    restoreEnvVar('CLAUDE_CONFIG_DIR', originalConfigDir);
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('getOutputSpeed ignores fallback tracking for non-file transcript paths', async () => {
  const tempHome = await createTempHome();

  try {
    const speed = getOutputSpeed(
      { transcript_path: tempHome, context_window: { current_usage: { input_tokens: 10 } } },
      { homeDir: () => tempHome, now: () => 1000 }
    );
    assert.equal(speed, null);

    const cacheDir = path.join(tempHome, '.claude', 'plugins', 'claude-hud', 'speed-cache');
    assert.equal(existsSync(cacheDir), false);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('getOutputSpeed returns null when transcript_path is missing', async () => {
  const tempHome = await createTempHome();

  try {
    const base = { homeDir: () => tempHome };
    const speed = getOutputSpeed(
      { context_window: { current_usage: { output_tokens: 10 } } },
      { ...base, now: () => 1000 }
    );
    assert.equal(speed, null);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('getOutputSpeed computes tokens per second within window', async () => {
  const tempHome = await createTempHome();
  const transcriptPath = await createTranscript(tempHome);

  try {
    const base = { homeDir: () => tempHome };
    const first = getOutputSpeed(stdinWith(transcriptPath, 10), { ...base, now: () => 1000 });
    assert.equal(first, null);

    const second = getOutputSpeed(stdinWith(transcriptPath, 20), { ...base, now: () => 1500 });
    assert.ok(second !== null);
    assert.ok(Math.abs(second - 20) < 0.01);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('getOutputSpeed ignores sub-window bursts to avoid inflated rates', async () => {
  const tempHome = await createTempHome();
  const transcriptPath = await createTranscript(tempHome);

  try {
    const base = { homeDir: () => tempHome };
    getOutputSpeed(stdinWith(transcriptPath, 10), { ...base, now: () => 1000 });

    // Status line re-renders ~50ms later with 60 more tokens. A naive rate
    // calculation would report 1200 tok/s; we expect null instead (#481).
    const speed = getOutputSpeed(stdinWith(transcriptPath, 70), { ...base, now: () => 1050 });
    assert.equal(speed, null);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('getOutputSpeed accumulates repeated short windows until the sample matures', async () => {
  const tempHome = await createTempHome();
  const transcriptPath = await createTranscript(tempHome);

  try {
    const base = { homeDir: () => tempHome };
    getOutputSpeed(stdinWith(transcriptPath, 10), { ...base, now: () => 1000 });

    const firstBurst = getOutputSpeed(stdinWith(transcriptPath, 40), { ...base, now: () => 1200 });
    assert.equal(firstBurst, null);

    const secondBurst = getOutputSpeed(stdinWith(transcriptPath, 70), { ...base, now: () => 1400 });
    assert.equal(secondBurst, null);

    const matured = getOutputSpeed(stdinWith(transcriptPath, 100), { ...base, now: () => 1600 });
    assert.ok(matured !== null);
    assert.ok(Math.abs(matured - 150) < 0.01);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('getOutputSpeed ignores stale windows', async () => {
  const tempHome = await createTempHome();
  const transcriptPath = await createTranscript(tempHome);

  try {
    const base = { homeDir: () => tempHome };
    getOutputSpeed(stdinWith(transcriptPath, 10), { ...base, now: () => 1000 });

    const speed = getOutputSpeed(stdinWith(transcriptPath, 30), { ...base, now: () => 8000 });
    assert.equal(speed, null);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('getOutputSpeed isolates cache across concurrent sessions', async () => {
  const tempHome = await createTempHome();
  const sessionA = await createTranscript(tempHome, 'session-a.jsonl');
  const sessionB = await createTranscript(tempHome, 'session-b.jsonl');

  try {
    const base = { homeDir: () => tempHome };

    // Session A streams: seeds its cache, then reports a speed on the next tick.
    getOutputSpeed(stdinWith(sessionA, 100), { ...base, now: () => 1000 });
    const aSpeed = getOutputSpeed(stdinWith(sessionA, 200), { ...base, now: () => 1500 });
    assert.ok(aSpeed !== null);

    // Session B is idle with a much smaller counter. Before the fix, B would
    // read A's cache entry as its `previous`, compute a bogus speed, or reset
    // A's cache to B's value and poison subsequent A readings. With per-session
    // caches the first B tick must seed a fresh cache and return null.
    const bFirst = getOutputSpeed(stdinWith(sessionB, 5), { ...base, now: () => 1600 });
    assert.equal(bFirst, null);

    // Session A's cache must survive B's tick and keep producing stable speeds.
    const aContinued = getOutputSpeed(stdinWith(sessionA, 300), { ...base, now: () => 2000 });
    assert.ok(aContinued !== null);
    assert.ok(Math.abs(aContinued - 200) < 0.01);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('getOutputSpeed writes cache under CLAUDE_CONFIG_DIR by default', async () => {
  const tempHome = await createTempHome();
  const customConfigDir = path.join(tempHome, '.claude-alt');
  const originalHome = process.env.HOME;
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.HOME = tempHome;
  process.env.CLAUDE_CONFIG_DIR = customConfigDir;

  try {
    const transcriptPath = await createTranscript(tempHome);
    const first = getOutputSpeed(stdinWith(transcriptPath, 10), { now: () => 1000 });
    assert.equal(first, null);

    const second = getOutputSpeed(stdinWith(transcriptPath, 20), { now: () => 1500 });
    assert.ok(second !== null);

    const customCacheDir = path.join(customConfigDir, 'plugins', 'claude-hud', 'speed-cache');
    const defaultCacheDir = path.join(tempHome, '.claude', 'plugins', 'claude-hud', 'speed-cache');
    assert.equal(existsSync(customCacheDir), true);
    assert.equal(existsSync(defaultCacheDir), false);
    assert.equal((await stat(customCacheDir)).mode & 0o777, 0o700);

    const cacheFiles = await readdir(customCacheDir);
    const speedCache = cacheFiles.find((name) => name.endsWith('.json'));
    assert.ok(speedCache, `expected speed cache in ${cacheFiles.join(', ')}`);
    assert.equal((await stat(path.join(customCacheDir, speedCache))).mode & 0o777, 0o600);
  } finally {
    restoreEnvVar('HOME', originalHome);
    restoreEnvVar('CLAUDE_CONFIG_DIR', originalConfigDir);
    await rm(tempHome, { recursive: true, force: true });
  }
});
