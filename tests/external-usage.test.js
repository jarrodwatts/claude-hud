import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { getUsageFromStdin } from '../src/stdin.ts';
import * as logic from '../src/external-usage.ts';
import { createProbes, resolveUsagePaths, writeUsageSnapshot } from '../collector.mjs';

// Both halves: collector.mjs validates the paths and reads and writes the files; logic parses
// what was read and decides what to write.
async function answer(config, probe) {
  const usage = resolveUsagePaths({ read: config.display.externalUsagePath, write: config.display.externalUsageWritePath });
  return { usage, value: (await createProbes({ argv: [], usage })([probe]))[probe] };
}

async function getUsageFromExternalSnapshot(config, now) {
  return logic.getUsageFromExternalSnapshot((await answer(config, 'usage.read')).value, config, now);
}

async function resolveUsage(config, stdinUsage, now) {
  return logic.resolveUsage(config, stdinUsage, (await answer(config, 'usage.read')).value, now);
}

async function writeExternalUsageSnapshot(config, usage, now) {
  const { usage: paths, value: target } = await answer(config, 'usage.target');
  return writeUsageSnapshot(paths.write, logic.externalUsageSnapshot(target, usage, now), now);
}

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

function makeWriteConfig(filePath) {
  return {
    ...DEFAULT_CONFIG,
    display: {
      ...DEFAULT_CONFIG.display,
      externalUsageWritePath: filePath,
    },
  };
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function makeUsage(overrides = {}) {
  return {
    fiveHour: 42,
    sevenDay: 85,
    fiveHourResetAt: new Date('2026-04-20T15:00:00.000Z'),
    sevenDayResetAt: new Date('2026-04-27T12:00:00.000Z'),
    ...overrides,
  };
}

test('getUsageFromExternalSnapshot returns null without a configured path', async () => {
  const usage = await getUsageFromExternalSnapshot(DEFAULT_CONFIG, Date.now());
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
    const usage = await getUsageFromExternalSnapshot(makeConfig(filePath), updatedAt + 60_000);
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

test('getUsageFromExternalSnapshot ignores relative read paths', async () => {
  const usage = await getUsageFromExternalSnapshot(makeConfig('usage.json'), Date.now());
  assert.equal(usage, null);
});

test('writeExternalUsageSnapshot writes stdin rate limits to the configured path', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-external-usage-write-'));
  const filePath = path.join(dir, 'usage.json');
  const now = Date.UTC(2026, 3, 20, 12, 0, 0);
  const usage = getUsageFromStdin({
    rate_limits: {
      five_hour: { used_percentage: 42.4, resets_at: 1776697200 },
      seven_day: { used_percentage: 84.6, resets_at: 1777291200 },
    },
  });

  try {
    const wrote = await writeExternalUsageSnapshot(makeWriteConfig(filePath), usage, now);
    const snapshot = JSON.parse(await readFile(filePath, 'utf8'));
    const fileMode = (await stat(filePath)).mode & 0o777;

    assert.equal(wrote, true);
    assert.equal(fileMode, 0o600);
    assert.deepEqual(snapshot, {
      updated_at: new Date(now).toISOString(),
      five_hour: {
        used_percentage: 42,
        resets_at: '2026-04-20T15:00:00.000Z',
      },
      seven_day: {
        used_percentage: 85,
        resets_at: '2026-04-27T12:00:00.000Z',
      },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writeExternalUsageSnapshot skips identical snapshots within the throttle window', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-external-usage-write-'));
  const filePath = path.join(dir, 'usage.json');
  const config = makeWriteConfig(filePath);
  const usage = makeUsage();

  try {
    assert.equal(await writeExternalUsageSnapshot(config, usage, Date.now()), true);
    const firstStat = await stat(filePath);
    assert.equal(await writeExternalUsageSnapshot(config, usage, Date.now() + 1000), false);
    const secondStat = await stat(filePath);

    assert.equal(secondStat.mtimeMs, firstStat.mtimeMs);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writeExternalUsageSnapshot writes nothing for an unusable path or usage', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-external-usage-write-'));
  const target = path.join(dir, 'usage.json');
  const scopedOnly = { fiveHour: null, sevenDay: null, fiveHourResetAt: null, sevenDayResetAt: null, scopedWindows: [{ label: 'Fable', percent: 38, resetAt: null }] };
  try {
    for (const [config, usage] of [
      [DEFAULT_CONFIG, makeUsage()],
      [makeWriteConfig('usage.json'), makeUsage()],
      [makeWriteConfig(path.join(dir, 'usage.txt')), makeUsage()],
      [makeWriteConfig(target), getUsageFromStdin({ rate_limits: null })],
      [makeWriteConfig(target), scopedOnly],
    ]) {
      assert.equal(await writeExternalUsageSnapshot(config, usage, Date.now()), false);
    }
    assert.deepEqual(await fs.promises.readdir(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writeExternalUsageSnapshot does not create missing parent directories', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-external-usage-write-'));
  const missingDir = path.join(dir, 'missing');
  const filePath = path.join(missingDir, 'usage.json');

  try {
    const wrote = await writeExternalUsageSnapshot(makeWriteConfig(filePath), makeUsage(), Date.now());

    assert.equal(wrote, false);
    assert.equal(await pathExists(missingDir), false);
    assert.equal(await pathExists(filePath), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writeExternalUsageSnapshot removes temp files when atomic rename fails', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-external-usage-write-'));
  const filePath = path.join(dir, 'usage.json');
  // A non-empty directory at the target makes the rename fail.
  await mkdir(filePath);
  await writeFile(path.join(filePath, 'keep'), 'x');

  try {
    const wrote = await writeExternalUsageSnapshot(makeWriteConfig(filePath), makeUsage(), Date.now());

    assert.equal(wrote, false);
    assert.deepEqual(await fs.promises.readdir(dir), ['usage.json']);
    assert.deepEqual(await fs.promises.readdir(filePath), ['keep']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the usage paths must be absolute, and the write path a .json file', () => {
  const home = path.join(tmpdir(), 'home');
  assert.deepEqual(resolveUsagePaths({ read: 'usage.json', write: 'usage.json' }, home, {}), { read: null, write: null });
  assert.deepEqual(resolveUsagePaths({ read: '~/u.json', write: '${OUT}/w.JSON' }, home, { OUT: home }), {
    read: path.join(home, 'u.json'),
    write: path.join(home, 'w.JSON'),
  });
  assert.equal(resolveUsagePaths({ write: path.join(home, 'w.txt') }, home, {}).write, null);
  assert.deepEqual(resolveUsagePaths({ read: 42, write: null }, home, {}), { read: null, write: null });
});

test('writeExternalUsageSnapshot emits only supported snapshot keys', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-external-usage-write-'));
  const filePath = path.join(dir, 'usage.json');
  const usage = getUsageFromStdin({
    rate_limits: {
      five_hour: { used_percentage: 12, resets_at: 1776697200, extra: 'ignored' },
      seven_day: { used_percentage: 34, resets_at: 1777291200, extra: 'ignored' },
      extra_window: { used_percentage: 99 },
    },
  });

  try {
    await writeExternalUsageSnapshot(makeWriteConfig(filePath), usage, Date.now());
    const snapshot = JSON.parse(await readFile(filePath, 'utf8'));

    assert.deepEqual(Object.keys(snapshot).sort(), ['five_hour', 'seven_day', 'updated_at']);
    assert.deepEqual(Object.keys(snapshot.five_hour).sort(), ['resets_at', 'used_percentage']);
    assert.deepEqual(Object.keys(snapshot.seven_day).sort(), ['resets_at', 'used_percentage']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writeExternalUsageSnapshot output can be read by getUsageFromExternalSnapshot', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-external-usage-write-'));
  const filePath = path.join(dir, 'usage.json');
  const now = Date.UTC(2026, 3, 20, 12, 0, 0);

  try {
    await writeExternalUsageSnapshot(makeWriteConfig(filePath), makeUsage(), now);
    const usage = await getUsageFromExternalSnapshot(makeConfig(filePath), now + 1000);

    assert.deepEqual(usage, makeUsage());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getUsageFromExternalSnapshot parses optional balance labels', async () => {
  const updatedAt = Date.UTC(2026, 3, 20, 12, 0, 0);
  const { filePath, cleanup } = await withTempFile(JSON.stringify({
    updated_at: new Date(updatedAt).toISOString(),
    balance_label: ' ¥6.35 ',
  }));

  try {
    const usage = await getUsageFromExternalSnapshot(makeConfig(filePath), updatedAt + 60_000);
    assert.deepEqual(usage, {
      fiveHour: null,
      sevenDay: null,
      fiveHourResetAt: null,
      sevenDayResetAt: null,
      balanceLabel: '¥6.35',
    });
  } finally {
    await cleanup();
  }
});

test('getUsageFromExternalSnapshot sanitizes balance labels before rendering', async () => {
  const updatedAt = Date.UTC(2026, 3, 20, 12, 0, 0);
  const { filePath, cleanup } = await withTempFile(JSON.stringify({
    updated_at: new Date(updatedAt).toISOString(),
    five_hour: { used_percentage: 42 },
    balance_label: '\u001b]8;;https://evil.example\u0007click\u001b]8;;\u0007\u202E',
  }));

  try {
    const usage = await getUsageFromExternalSnapshot(makeConfig(filePath), updatedAt + 60_000);
    assert.equal(usage?.balanceLabel, 'click');
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
    const usage = await getUsageFromExternalSnapshot(makeConfig(filePath, 1000), updatedAt + 1001);
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
    const usage = await getUsageFromExternalSnapshot(makeConfig(filePath), updatedAt + 1);
    assert.equal(usage, null);
  } finally {
    await cleanup();
  }
});

test('getUsageFromExternalSnapshot returns null for invalid JSON', async () => {
  const { filePath, cleanup } = await withTempFile('{');

  try {
    const usage = await getUsageFromExternalSnapshot(makeConfig(filePath), Date.now());
    assert.equal(usage, null);
  } finally {
    await cleanup();
  }
});

test('getUsageFromExternalSnapshot parses model-scoped windows', async () => {
  const updatedAt = Date.UTC(2026, 3, 20, 12, 0, 0);
  const { filePath, cleanup } = await withTempFile(JSON.stringify({
    updated_at: new Date(updatedAt).toISOString(),
    five_hour: { used_percentage: 42.4, resets_at: '2026-04-20T15:00:00.000Z' },
    model_scoped: [
      { display_name: 'Fable', utilization: 89.4, resets_at: '2026-04-27T12:00:00.000Z' },
    ],
  }));

  try {
    const usage = await getUsageFromExternalSnapshot(makeConfig(filePath), updatedAt + 60_000);
    assert.deepEqual(usage?.scopedWindows, [{
      label: 'Fable',
      percent: 89,
      resetAt: new Date('2026-04-27T12:00:00.000Z'),
    }]);
    assert.equal(usage?.fiveHour, 42);
  } finally {
    await cleanup();
  }
});

test('getUsageFromExternalSnapshot accepts a scoped-only snapshot', async () => {
  const updatedAt = Date.UTC(2026, 3, 20, 12, 0, 0);
  const { filePath, cleanup } = await withTempFile(JSON.stringify({
    updated_at: new Date(updatedAt).toISOString(),
    model_scoped: [
      { display_name: 'Fable', utilization: 57, resets_at: null },
    ],
  }));

  try {
    const usage = await getUsageFromExternalSnapshot(makeConfig(filePath), updatedAt + 60_000);
    assert.deepEqual(usage, {
      fiveHour: null,
      sevenDay: null,
      fiveHourResetAt: null,
      sevenDayResetAt: null,
      scopedWindows: [{ label: 'Fable', percent: 57, resetAt: null }],
    });
  } finally {
    await cleanup();
  }
});

test('getUsageFromExternalSnapshot drops malformed scoped entries and sanitizes labels', async () => {
  const updatedAt = Date.UTC(2026, 3, 20, 12, 0, 0);
  const { filePath, cleanup } = await withTempFile(JSON.stringify({
    updated_at: new Date(updatedAt).toISOString(),
    model_scoped: [
      { display_name: '[31mFable[0m', utilization: 12, resets_at: null },
      { display_name: '', utilization: 50, resets_at: null },
      { display_name: 'Bad', utilization: 'oops', resets_at: null },
      'not-an-object',
    ],
  }));

  try {
    const usage = await getUsageFromExternalSnapshot(makeConfig(filePath), updatedAt + 60_000);
    assert.deepEqual(usage?.scopedWindows, [{ label: 'Fable', percent: 12, resetAt: null }]);
  } finally {
    await cleanup();
  }
});

test('getUsageFromExternalSnapshot cuts a scoped label on a grapheme boundary', async () => {
  const updatedAt = Date.UTC(2026, 3, 20, 12, 0, 0);
  const { filePath, cleanup } = await withTempFile(JSON.stringify({
    updated_at: new Date(updatedAt).toISOString(),
    model_scoped: [
      { display_name: 'A'.repeat(63) + '😀' + 'B', utilization: 12, resets_at: null },
    ],
  }));

  try {
    const usage = await getUsageFromExternalSnapshot(makeConfig(filePath), updatedAt + 60_000);
    assert.deepEqual(usage?.scopedWindows, [{ label: 'A'.repeat(63), percent: 12, resetAt: null }]);
  } finally {
    await cleanup();
  }
});

test('getUsageFromExternalSnapshot ignores a non-array model_scoped value', async () => {
  const updatedAt = Date.UTC(2026, 3, 20, 12, 0, 0);
  const { filePath, cleanup } = await withTempFile(JSON.stringify({
    updated_at: new Date(updatedAt).toISOString(),
    five_hour: { used_percentage: 10, resets_at: null },
    model_scoped: { display_name: 'Fable', utilization: 12 },
  }));

  try {
    const usage = await getUsageFromExternalSnapshot(makeConfig(filePath), updatedAt + 60_000);
    assert.equal(usage?.scopedWindows, undefined);
    assert.equal(usage?.fiveHour, 10);
  } finally {
    await cleanup();
  }
});

test('getUsageFromExternalSnapshot bounds and clamps scoped windows', async () => {
  const updatedAt = Date.UTC(2026, 3, 20, 12, 0, 0);
  const { filePath, cleanup } = await withTempFile(JSON.stringify({
    updated_at: new Date(updatedAt).toISOString(),
    model_scoped: Array.from({ length: 12 }, (_, i) => ({ display_name: `${'x'.repeat(100)}${i}`, utilization: i === 0 ? 140 : -5 })),
  }));
  try {
    const windows = (await getUsageFromExternalSnapshot(makeConfig(filePath), updatedAt))?.scopedWindows ?? [];
    assert.equal(windows.length, 8);
    assert.equal(windows[0].label.length, 64);
    assert.deepEqual(windows.slice(0, 2).map((w) => w.percent), [100, 0]);
  } finally {
    await cleanup();
  }
});

test('resolveUsage prefers stdin and fills gaps from the snapshot', async () => {
  const updatedAt = Date.UTC(2026, 3, 20, 12, 0, 0);
  const { filePath, cleanup } = await withTempFile(JSON.stringify({
    updated_at: new Date(updatedAt).toISOString(),
    five_hour: { used_percentage: 90, resets_at: null },
    seven_day: { used_percentage: 60, resets_at: '2026-04-27T12:00:00.000Z' },
    balance_label: '¥6.35',
    model_scoped: [{ display_name: 'Fable', utilization: 38 }],
  }));
  try {
    const config = makeConfig(filePath);
    const fiveHourOnly = makeUsage({ sevenDay: null, sevenDayResetAt: null });
    assert.deepEqual(await resolveUsage(config, fiveHourOnly, updatedAt), {
      ...fiveHourOnly,
      balanceLabel: '¥6.35',
      sevenDay: 60,
      sevenDayResetAt: new Date('2026-04-27T12:00:00.000Z'),
      scopedWindows: [{ label: 'Fable', percent: 38, resetAt: null }],
    });
    assert.equal((await resolveUsage(config, null, updatedAt))?.fiveHour, 90, 'snapshot stands in when stdin has none');
    assert.equal((await resolveUsage(makeConfig(''), makeUsage(), updatedAt)).balanceLabel, undefined);
  } finally {
    await cleanup();
  }
});
