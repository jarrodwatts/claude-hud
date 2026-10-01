import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
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
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const originalApiKey = process.env.ANTHROPIC_API_KEY;

  try {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    await mkdir(configDir, { recursive: true });

    assert.deepEqual(readAuthInfo(), { method: null, user: null });

    // Claude Code keeps claude.json INSIDE the overridden config directory.
    const jsonPath = path.join(configDir, '.claude.json');
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
