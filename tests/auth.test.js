import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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

    assert.deepEqual(readAuthInfo(), { method: null, user: null });

    await writeFile(`${configDir}.json`, JSON.stringify(MAX_ACCOUNT), 'utf8');
    assert.deepEqual(readAuthInfo(), { method: 'Claude Max 20x', user: 'someone.long' });

    await writeFile(`${configDir}.json`, '{invalid', 'utf8');
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
