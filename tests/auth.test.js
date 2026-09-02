import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { deriveAuthInfo, readAuthInfo, truncateUser, formatAuthSegment } from '../dist/auth.js';

const MAX_ACCOUNT = {
  oauthAccount: {
    emailAddress: 'someone.long@example.com',
    displayName: 'Some One',
    organizationType: 'claude_max',
    organizationRateLimitTier: 'default_claude_max_20x',
  },
};

function restoreEnvVar(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

test('deriveAuthInfo formats claude_max with rate-limit tier', () => {
  const info = deriveAuthInfo(MAX_ACCOUNT, {});
  assert.equal(info.method, 'Claude Max 20x');
  assert.equal(info.user, 'someone.long');
});

test('deriveAuthInfo formats claude_pro without tier', () => {
  const info = deriveAuthInfo({
    oauthAccount: {
      emailAddress: 'a@b.com',
      organizationType: 'claude_pro',
      organizationRateLimitTier: 'default_claude_pro',
    },
  }, {});
  assert.equal(info.method, 'Claude Pro');
  assert.equal(info.user, 'a');
});

test('deriveAuthInfo falls back to displayName without email', () => {
  const info = deriveAuthInfo({
    oauthAccount: {
      displayName: 'Some One',
      organizationType: 'claude_enterprise',
    },
  }, {});
  assert.equal(info.method, 'Claude Enterprise');
  assert.equal(info.user, 'Some One');
});

test('deriveAuthInfo reports API Key when no oauth account but key exported', () => {
  const info = deriveAuthInfo({}, { ANTHROPIC_API_KEY: 'sk-test' });
  assert.equal(info.method, 'API Key');
  assert.equal(info.user, null);
});

test('deriveAuthInfo gives API Key precedence over a stale oauth account', () => {
  const info = deriveAuthInfo(MAX_ACCOUNT, { ANTHROPIC_API_KEY: 'sk-test' });
  assert.deepEqual(info, { method: 'API Key', user: null });
});

test('deriveAuthInfo returns nulls for missing/invalid input', () => {
  assert.deepEqual(deriveAuthInfo(null, {}), { method: null, user: null });
  assert.deepEqual(deriveAuthInfo('junk', {}), { method: null, user: null });
  assert.deepEqual(deriveAuthInfo({ oauthAccount: 42 }, {}), { method: null, user: null });
});

test('deriveAuthInfo strips ANSI sequences and control characters from values', () => {
  const info = deriveAuthInfo({
    oauthAccount: {
      emailAddress: 'evil\x1b[31m@example.com',
      organizationType: 'claude_max',
    },
  }, {});
  assert.equal(info.user, 'evil');
});

test('readAuthInfo honors CLAUDE_CONFIG_DIR and handles unreadable profiles', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-auth-test-'));
  const configDir = path.join(tempDir, 'profile');
  const jsonPath = path.join(configDir, '.claude.json');
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const originalApiKey = process.env.ANTHROPIC_API_KEY;

  try {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CONFIG_DIR = configDir;

    assert.deepEqual(readAuthInfo(), { method: null, user: null });

    await mkdir(configDir, { recursive: true });
    await writeFile(jsonPath, JSON.stringify(MAX_ACCOUNT), 'utf8');
    assert.deepEqual(readAuthInfo(), { method: 'Claude Max 20x', user: 'someone.long' });

    await writeFile(jsonPath, '{invalid', 'utf8');
    assert.deepEqual(readAuthInfo(), { method: null, user: null });
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', originalConfigDir);
    restoreEnvVar('ANTHROPIC_API_KEY', originalApiKey);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('readAuthInfo reports an API key without requiring an oauth profile', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-auth-key-test-'));
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const originalApiKey = process.env.ANTHROPIC_API_KEY;

  try {
    process.env.CLAUDE_CONFIG_DIR = path.join(tempDir, 'missing');
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    assert.deepEqual(readAuthInfo(), { method: 'API Key', user: null });
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', originalConfigDir);
    restoreEnvVar('ANTHROPIC_API_KEY', originalApiKey);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('truncateUser truncates with ellipsis and honors 0 = full', () => {
  assert.equal(truncateUser('yukinoshita.reimu', 8), 'yukinosh…');
  assert.equal(truncateUser('short', 8), 'short');
  assert.equal(truncateUser('yukinoshita.reimu', 0), 'yukinoshita.reimu');
});

test('formatAuthSegment joins method and truncated user', () => {
  const info = deriveAuthInfo(MAX_ACCOUNT, {});
  assert.equal(
    formatAuthSegment(info, { showAuth: true, showAuthUser: true, authUserLength: 8 }),
    'Claude Max 20x · someone.…',
  );
  assert.equal(
    formatAuthSegment(info, { showAuth: true, showAuthUser: false }),
    'Claude Max 20x',
  );
  assert.equal(
    formatAuthSegment(info, { showAuth: false, showAuthUser: true, authUserLength: 0 }),
    'someone.long',
  );
  assert.equal(formatAuthSegment(info, { showAuth: false, showAuthUser: false }), null);
  assert.equal(formatAuthSegment(null, { showAuth: true, showAuthUser: true }), null);
});

// --- derived-auth caching -------------------------------------------------
// claude.json is the user's entire CLI config and grows with project history.
// The status line runs on every interaction, so an uncached parse is paid per
// tick. These tests exist because a cache that silently does nothing is still
// CORRECT, just slow -- a performance property with no test regresses unnoticed.

test('readAuthInfo caches derived auth and serves it on an unchanged file', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hud-auth-cache-'));
  const configDir = path.join(dir, '.claude');
  const original = process.env.CLAUDE_CONFIG_DIR;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const fsSync = await import('node:fs');

  try {
    delete process.env.ANTHROPIC_API_KEY;   // force the file path
    process.env.CLAUDE_CONFIG_DIR = configDir;
    fsSync.mkdirSync(configDir, { recursive: true });
    const jsonPath = path.join(configDir, '.claude.json');
    await writeFile(jsonPath, JSON.stringify(MAX_ACCOUNT), 'utf8');

    assert.deepEqual(readAuthInfo(), { method: 'Claude Max 20x', user: 'someone.long' });

    const cacheFile = path.join(configDir, 'plugins', 'claude-hud', 'auth-cache', 'auth.json');
    assert.ok(fsSync.existsSync(cacheFile), 'first read must write a cache entry');

    assert.deepEqual(readAuthInfo(), { method: 'Claude Max 20x', user: 'someone.long' });
    assert.equal(fsSync.statSync(path.dirname(cacheFile)).mode & 0o777, 0o700);
    assert.equal(fsSync.statSync(cacheFile).mode & 0o777, 0o600);
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', original);
    restoreEnvVar('ANTHROPIC_API_KEY', originalKey);
    await rm(dir, { recursive: true, force: true });
  }
});

test('readAuthInfo re-parses when claude.json actually changes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hud-auth-bust-'));
  const configDir = path.join(dir, '.claude');
  const original = process.env.CLAUDE_CONFIG_DIR;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const fsSync = await import('node:fs');

  try {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    fsSync.mkdirSync(configDir, { recursive: true });
    const jsonPath = path.join(configDir, '.claude.json');
    await writeFile(jsonPath, JSON.stringify(MAX_ACCOUNT), 'utf8');
    assert.equal(readAuthInfo().user, 'someone.long');

    await writeFile(jsonPath, JSON.stringify({
      oauthAccount: { emailAddress: 'other@example.com', organizationType: 'claude_pro' },
    }), 'utf8');
    const future = new Date(Date.now() + 5000);
    fsSync.utimesSync(jsonPath, future, future);

    assert.equal(readAuthInfo().user, 'other', 'a changed file must bust the cache');
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', original);
    restoreEnvVar('ANTHROPIC_API_KEY', originalKey);
    await rm(dir, { recursive: true, force: true });
  }
});

// Size is in the key alongside mtime because two writes can land in the same
// millisecond. Hard to provoke by racing the clock, so the entry is forged.
test('readAuthInfo busts the cache when only the SIZE differs', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hud-auth-size-'));
  const configDir = path.join(dir, '.claude');
  const original = process.env.CLAUDE_CONFIG_DIR;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const fsSync = await import('node:fs');

  try {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    fsSync.mkdirSync(configDir, { recursive: true });
    const jsonPath = path.join(configDir, '.claude.json');
    await writeFile(jsonPath, JSON.stringify(MAX_ACCOUNT), 'utf8');
    assert.equal(readAuthInfo().user, 'someone.long', 'seed the cache');

    const cacheFile = path.join(configDir, 'plugins', 'claude-hud', 'auth-cache', 'auth.json');
    const stat = fsSync.statSync(jsonPath);
    fsSync.writeFileSync(cacheFile, JSON.stringify({
      version: 1,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
      size: stat.size + 1,
      dev: stat.dev,
      ino: stat.ino,
      method: 'STALE',
      user: 'stale-user',
    }), 'utf8');

    assert.equal(readAuthInfo().user, 'someone.long',
      'a size mismatch must bust the cache and re-parse');
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', original);
    restoreEnvVar('ANTHROPIC_API_KEY', originalKey);
    await rm(dir, { recursive: true, force: true });
  }
});

test('readAuthInfo rejects a poisoned cache even when source identity matches', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hud-auth-poison-'));
  const configDir = path.join(dir, '.claude');
  const original = process.env.CLAUDE_CONFIG_DIR;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const fsSync = await import('node:fs');

  try {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    fsSync.mkdirSync(configDir, { recursive: true });
    const jsonPath = path.join(configDir, '.claude.json');
    await writeFile(jsonPath, JSON.stringify(MAX_ACCOUNT), 'utf8');
    assert.equal(readAuthInfo().user, 'someone.long');

    const cacheFile = path.join(configDir, 'plugins', 'claude-hud', 'auth-cache', 'auth.json');
    const stat = fsSync.statSync(jsonPath);
    fsSync.writeFileSync(cacheFile, JSON.stringify({
      version: 1,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
      size: stat.size,
      dev: stat.dev,
      ino: stat.ino,
      method: 'Max\x1b[31m',
      user: 'attacker\x1b]8;;https://evil.test\x07link\x1b]8;;\x07',
    }), { encoding: 'utf8', mode: 0o600 });

    assert.deepEqual(readAuthInfo(), { method: 'Claude Max 20x', user: 'someone.long' });
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', original);
    restoreEnvVar('ANTHROPIC_API_KEY', originalKey);
    await rm(dir, { recursive: true, force: true });
  }
});

test('readAuthInfo rejects symlink cache files without touching their target', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hud-auth-symlink-'));
  const configDir = path.join(dir, '.claude');
  const original = process.env.CLAUDE_CONFIG_DIR;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const fsSync = await import('node:fs');

  try {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    fsSync.mkdirSync(configDir, { recursive: true });
    await writeFile(path.join(configDir, '.claude.json'), JSON.stringify(MAX_ACCOUNT), 'utf8');
    assert.equal(readAuthInfo().user, 'someone.long');

    const cacheFile = path.join(configDir, 'plugins', 'claude-hud', 'auth-cache', 'auth.json');
    const target = path.join(dir, 'target.json');
    await writeFile(target, 'do-not-touch', 'utf8');
    fsSync.unlinkSync(cacheFile);
    fsSync.symlinkSync(target, cacheFile);

    assert.equal(readAuthInfo().user, 'someone.long');
    assert.equal(fsSync.readFileSync(target, 'utf8'), 'do-not-touch');
    assert.equal(fsSync.lstatSync(cacheFile).isSymbolicLink(), false);
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', original);
    restoreEnvVar('ANTHROPIC_API_KEY', originalKey);
    await rm(dir, { recursive: true, force: true });
  }
});

test('readAuthInfo detects same-size rewrites with a restored mtime', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hud-auth-ctime-'));
  const configDir = path.join(dir, '.claude');
  const original = process.env.CLAUDE_CONFIG_DIR;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const fsSync = await import('node:fs');

  try {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    fsSync.mkdirSync(configDir, { recursive: true });
    const jsonPath = path.join(configDir, '.claude.json');
    const first = JSON.stringify(MAX_ACCOUNT);
    const second = first.replace('someone.long', 'another.long');
    assert.equal(first.length, second.length);
    await writeFile(jsonPath, first, 'utf8');
    assert.equal(readAuthInfo().user, 'someone.long');

    const originalStat = fsSync.statSync(jsonPath);
    await writeFile(jsonPath, second, 'utf8');
    fsSync.utimesSync(jsonPath, originalStat.atime, originalStat.mtime);

    assert.equal(readAuthInfo().user, 'another.long');
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', original);
    restoreEnvVar('ANTHROPIC_API_KEY', originalKey);
    await rm(dir, { recursive: true, force: true });
  }
});
