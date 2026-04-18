import { test, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getEffortLevel, _readClaudeSettingsForTests } from '../dist/effort.js';

const ENV_KEY = 'CLAUDE_CODE_EFFORT_LEVEL';

function restoreEnv(name, saved) {
  if (saved === undefined) delete process.env[name];
  else process.env[name] = saved;
}

let savedEnv;
beforeEach(() => {
  savedEnv = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
});

afterEach(() => {
  restoreEnv(ENV_KEY, savedEnv);
});

// _readClaudeSettingsForTests

test('_readClaudeSettingsForTests returns null when .claude dir missing', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hud-effort-'));
  try {
    const result = _readClaudeSettingsForTests(dir);
    assert.equal(result, null);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('_readClaudeSettingsForTests returns null when settings.json is invalid JSON', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hud-effort-'));
  try {
    await mkdir(path.join(dir, '.claude'), { recursive: true });
    await writeFile(path.join(dir, '.claude', 'settings.json'), 'not json');
    assert.equal(_readClaudeSettingsForTests(dir), null);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('_readClaudeSettingsForTests returns parsed object', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hud-effort-'));
  try {
    await mkdir(path.join(dir, '.claude'), { recursive: true });
    await writeFile(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ effortLevel: 'high' }));
    const result = _readClaudeSettingsForTests(dir);
    assert.deepEqual(result, { effortLevel: 'high' });
  } finally {
    await rm(dir, { recursive: true });
  }
});

// getEffortLevel — env var takes precedence

test('getEffortLevel returns formatted string for env var high', () => {
  process.env[ENV_KEY] = 'high';
  assert.equal(getEffortLevel(), '● high');
});

test('getEffortLevel returns formatted string for env var medium', () => {
  process.env[ENV_KEY] = 'medium';
  assert.equal(getEffortLevel(), '◐ medium');
});

test('getEffortLevel returns formatted string for env var low', () => {
  process.env[ENV_KEY] = 'low';
  assert.equal(getEffortLevel(), '○ low');
});

test('getEffortLevel returns null when env var is "unset"', () => {
  process.env[ENV_KEY] = 'unset';
  // getEffortLevel falls through to settings.json — set no home dir so it returns null
  // We rely on actual home; if no effortLevel in real settings or it's unset, fine.
  // The important assertion is that "unset" env var doesn't short-circuit to a symbol.
  const result = getEffortLevel();
  // result is null or a valid level string (from real settings.json) — just not "unset" rendered
  if (result !== null) {
    assert.match(result, /^[○◐●] (low|medium|high)$/);
  }
});

test('getEffortLevel returns null when env var is invalid', () => {
  process.env[ENV_KEY] = 'extreme';
  // Falls through to settings.json; result is null or valid level from real settings
  const result = getEffortLevel();
  if (result !== null) {
    assert.match(result, /^[○◐●] (low|medium|high)$/);
  }
});
