import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_CONFIG } from '../dist/config.js';
import { getUsageFromStdin } from '../dist/stdin.js';
import { getUsageFromExternalSnapshot, resolveUsage, writeExternalUsageSnapshot } from '../dist/external-usage.js';

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

test('getUsageFromExternalSnapshot ignores relative read paths', () => {
  const usage = getUsageFromExternalSnapshot(makeConfig('usage.json'), Date.now());
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
    const wrote = writeExternalUsageSnapshot(makeWriteConfig(filePath), usage, now);
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
    assert.equal(writeExternalUsageSnapshot(config, usage, Date.now()), true);
    const firstStat = await stat(filePath);
    assert.equal(writeExternalUsageSnapshot(config, usage, Date.now() + 1000), false);
    const secondStat = await stat(filePath);

    assert.equal(secondStat.mtimeMs, firstStat.mtimeMs);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writeExternalUsageSnapshot never touches the filesystem for an unusable path or usage', () => {
  const calls = [];
  const untouchable = Object.fromEntries(
    ['chmodSync', 'readFileSync', 'renameSync', 'rmSync', 'statSync', 'writeFileSync']
      .map((name) => [name, () => calls.push(name)]),
  );
  const target = path.join(tmpdir(), 'usage.json');
  const scopedOnly = { fiveHour: null, sevenDay: null, fiveHourResetAt: null, sevenDayResetAt: null, scopedWindows: [{ label: 'Fable', percent: 38, resetAt: null }] };
  for (const [config, usage] of [
    [DEFAULT_CONFIG, makeUsage()],
    [makeWriteConfig('usage.json'), makeUsage()],
    [makeWriteConfig(path.join(tmpdir(), 'usage.txt')), makeUsage()],
    [makeWriteConfig(target), getUsageFromStdin({ rate_limits: null })],
    [makeWriteConfig(target), scopedOnly],
  ]) {
    assert.equal(writeExternalUsageSnapshot(config, usage, Date.now(), untouchable), false);
  }
  assert.deepEqual(calls, []);
});

test('writeExternalUsageSnapshot does not create missing parent directories', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-external-usage-write-'));
  const missingDir = path.join(dir, 'missing');
  const filePath = path.join(missingDir, 'usage.json');

  try {
    const wrote = writeExternalUsageSnapshot(makeWriteConfig(filePath), makeUsage(), Date.now());

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
  const deps = {
    chmodSync: fs.chmodSync,
    readFileSync: fs.readFileSync,
    renameSync: () => {
      throw new Error('rename failed');
    },
    rmSync: fs.rmSync,
    statSync: fs.statSync,
    writeFileSync: fs.writeFileSync,
  };

  try {
    const wrote = writeExternalUsageSnapshot(makeWriteConfig(filePath), makeUsage(), Date.now(), deps);
    const files = await fs.promises.readdir(dir);

    assert.equal(wrote, false);
    assert.equal(await pathExists(filePath), false);
    assert.deepEqual(files, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
    writeExternalUsageSnapshot(makeWriteConfig(filePath), usage, Date.now());
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
    writeExternalUsageSnapshot(makeWriteConfig(filePath), makeUsage(), now);
    const usage = getUsageFromExternalSnapshot(makeConfig(filePath), now + 1000);

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
    const usage = getUsageFromExternalSnapshot(makeConfig(filePath), updatedAt + 60_000);
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
    const usage = getUsageFromExternalSnapshot(makeConfig(filePath), updatedAt + 60_000);
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
    const usage = getUsageFromExternalSnapshot(makeConfig(filePath), updatedAt + 60_000);
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
    const usage = getUsageFromExternalSnapshot(makeConfig(filePath), updatedAt + 60_000);
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
    const usage = getUsageFromExternalSnapshot(makeConfig(filePath), updatedAt + 60_000);
    assert.deepEqual(usage?.scopedWindows, [{ label: 'Fable', percent: 12, resetAt: null }]);
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
    const usage = getUsageFromExternalSnapshot(makeConfig(filePath), updatedAt + 60_000);
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
    const windows = getUsageFromExternalSnapshot(makeConfig(filePath), updatedAt)?.scopedWindows ?? [];
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
    assert.deepEqual(resolveUsage(config, fiveHourOnly, updatedAt), {
      ...fiveHourOnly,
      balanceLabel: '¥6.35',
      sevenDay: 60,
      sevenDayResetAt: new Date('2026-04-27T12:00:00.000Z'),
      scopedWindows: [{ label: 'Fable', percent: 38, resetAt: null }],
    });
    assert.equal(resolveUsage(config, null, updatedAt)?.fiveHour, 90, 'snapshot stands in when stdin has none');
    assert.equal(resolveUsage(makeConfig(''), makeUsage(), updatedAt).balanceLabel, undefined);
  } finally {
    await cleanup();
  }
});
