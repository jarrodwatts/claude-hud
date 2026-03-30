import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { getAccountInfo, formatAccountLabel, _resetAccountCache, _setAccountReaderForTests } from '../dist/account.js';
import { renderSessionLine } from '../dist/render/session-line.js';
import { renderProjectLine } from '../dist/render/lines/project.js';
import { main } from '../dist/index.js';
import { DEFAULT_CONFIG } from '../dist/config.js';

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function baseContext(overrides = {}) {
  return {
    stdin: {
      model: { display_name: 'Opus' },
      context_window: {
        context_window_size: 200000,
        current_usage: { input_tokens: 10000 },
      },
    },
    transcript: { tools: [], agents: [], todos: [] },
    claudeMdCount: 0,
    rulesCount: 0,
    mcpCount: 0,
    hooksCount: 0,
    sessionDuration: '',
    gitStatus: null,
    usageData: null,
    memoryUsage: null,
    config: {
      ...DEFAULT_CONFIG,
      lineLayout: 'compact',
      display: { ...DEFAULT_CONFIG.display, showAccount: true },
    },
    extraLabel: null,
    accountInfo: null,
    ...overrides,
  };
}

// --- formatAccountLabel ---

test('formatAccountLabel returns email for personal org', () => {
  const result = formatAccountLabel({
    email: 'alice@example.com',
    displayName: 'Alice',
    orgName: "alice@example.com's Organization",
  });
  assert.equal(result, 'alice@example.com');
});

test('formatAccountLabel shows displayName @ orgName for distinct org', () => {
  const result = formatAccountLabel({
    email: 'alice@company.com',
    displayName: 'Alice',
    orgName: 'Acme Corp',
  });
  assert.equal(result, 'Alice @ Acme Corp');
});

test('formatAccountLabel uses email prefix when no displayName and distinct org', () => {
  const result = formatAccountLabel({
    email: 'alice@company.com',
    orgName: 'Acme Corp',
  });
  assert.equal(result, 'alice @ Acme Corp');
});

test('formatAccountLabel returns just email when no org', () => {
  const result = formatAccountLabel({ email: 'alice@example.com' });
  assert.equal(result, 'alice@example.com');
});

test('formatAccountLabel returns email when orgName is empty string', () => {
  const result = formatAccountLabel({ email: 'alice@example.com', orgName: '' });
  assert.equal(result, 'alice@example.com');
});

// --- getAccountInfo with test seam ---

test('getAccountInfo reads account via reader', async () => {
  _resetAccountCache();
  const tempDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-account-'));
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;

  try {
    process.env.CLAUDE_CONFIG_DIR = tempDir;
    // getClaudeConfigJsonPath produces ${tempDir}.json (sibling of the directory)
    await writeFile(`${tempDir}.json`, JSON.stringify({
      oauthAccount: {
        emailAddress: 'test@example.com',
        displayName: 'Test User',
        organizationName: 'Test Org',
      },
    }));

    const info = await getAccountInfo();
    assert.deepEqual(info, {
      email: 'test@example.com',
      displayName: 'Test User',
      orgName: 'Test Org',
    });
  } finally {
    _resetAccountCache();
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir ?? '';
    await rm(tempDir, { recursive: true });
    await rm(`${tempDir}.json`, { force: true });
  }
});

test('getAccountInfo returns null when config file does not exist', async () => {
  _resetAccountCache();
  const tempDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-account-'));
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;

  try {
    process.env.CLAUDE_CONFIG_DIR = tempDir;
    // No .json file created — statSync will throw ENOENT
    const info = await getAccountInfo();
    assert.equal(info, null);
  } finally {
    _resetAccountCache();
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir ?? '';
    await rm(tempDir, { recursive: true });
  }
});

test('getAccountInfo returns null when oauthAccount is missing', async () => {
  _resetAccountCache();
  const tempDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-account-'));
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;

  try {
    process.env.CLAUDE_CONFIG_DIR = tempDir;
    await writeFile(`${tempDir}.json`, JSON.stringify({ userID: 'abc' }));

    const info = await getAccountInfo();
    assert.equal(info, null);
  } finally {
    _resetAccountCache();
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir ?? '';
    await rm(tempDir, { recursive: true });
    await rm(`${tempDir}.json`, { force: true });
  }
});

test('getAccountInfo returns null for malformed JSON', async () => {
  _resetAccountCache();
  const tempDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-account-'));
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;

  try {
    process.env.CLAUDE_CONFIG_DIR = tempDir;
    await writeFile(`${tempDir}.json`, '{ not valid json!!!');

    const info = await getAccountInfo();
    assert.equal(info, null);
  } finally {
    _resetAccountCache();
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir ?? '';
    await rm(tempDir, { recursive: true });
    await rm(`${tempDir}.json`, { force: true });
  }
});

test('getAccountInfo returns null when emailAddress is not a string', async () => {
  _resetAccountCache();
  const tempDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-account-'));
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;

  try {
    process.env.CLAUDE_CONFIG_DIR = tempDir;
    await writeFile(`${tempDir}.json`, JSON.stringify({
      oauthAccount: { emailAddress: 42, displayName: 'Alice' },
    }));

    const info = await getAccountInfo();
    assert.equal(info, null);
  } finally {
    _resetAccountCache();
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir ?? '';
    await rm(tempDir, { recursive: true });
    await rm(`${tempDir}.json`, { force: true });
  }
});

test('getAccountInfo uses mtime cache on repeated calls', async () => {
  _resetAccountCache();
  let readCalls = 0;
  _setAccountReaderForTests((configPath) => {
    readCalls += 1;
    return { email: 'cached@test.com' };
  });

  const tempDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-account-'));
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;

  try {
    process.env.CLAUDE_CONFIG_DIR = tempDir;
    await writeFile(`${tempDir}.json`, '{}');

    await getAccountInfo();
    await getAccountInfo();
    await getAccountInfo();

    assert.equal(readCalls, 1, 'should only read file once when mtime unchanged');
  } finally {
    _resetAccountCache();
    _setAccountReaderForTests(null);
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir ?? '';
    await rm(tempDir, { recursive: true });
    await rm(`${tempDir}.json`, { force: true });
  }
});

// --- renderSessionLine with account ---

test('renderSessionLine shows account when enabled and accountInfo present', () => {
  const ctx = baseContext({
    accountInfo: { email: 'alice@company.com', displayName: 'Alice', orgName: 'Acme Corp' },
  });
  const line = stripAnsi(renderSessionLine(ctx));
  assert.ok(line.includes('Alice @ Acme Corp'), `Expected account in: ${line}`);
});

test('renderSessionLine omits account when showAccount is false', () => {
  const ctx = baseContext({
    config: {
      ...DEFAULT_CONFIG,
      lineLayout: 'compact',
      display: { ...DEFAULT_CONFIG.display, showAccount: false },
    },
    accountInfo: { email: 'alice@company.com', displayName: 'Alice', orgName: 'Acme Corp' },
  });
  const line = stripAnsi(renderSessionLine(ctx));
  assert.ok(!line.includes('Alice'), `Should not contain account in: ${line}`);
});

test('renderSessionLine omits account when accountInfo is null', () => {
  const ctx = baseContext({ accountInfo: null });
  const line = stripAnsi(renderSessionLine(ctx));
  assert.ok(!line.includes('@'), `Should not contain account in: ${line}`);
});

// --- renderProjectLine (expanded) with account ---

test('renderProjectLine shows account in expanded mode', () => {
  const ctx = baseContext({
    accountInfo: { email: 'bob@work.com', displayName: 'Bob', orgName: 'WorkCo' },
  });
  ctx.config.lineLayout = 'expanded';
  const line = stripAnsi(renderProjectLine(ctx));
  assert.ok(line.includes('Bob @ WorkCo'), `Expected account in: ${line}`);
});

// --- main integration ---

test('main includes accountInfo in render context when showAccount is enabled', async () => {
  _resetAccountCache();
  let renderedContext;
  let lookupCalls = 0;

  await main({
    readStdin: async () => ({
      model: { display_name: 'Opus' },
      context_window: { context_window_size: 100, current_usage: { input_tokens: 10 } },
    }),
    parseTranscript: async () => ({ tools: [], agents: [], todos: [] }),
    countConfigs: async () => ({ claudeMdCount: 0, rulesCount: 0, mcpCount: 0, hooksCount: 0 }),
    getGitStatus: async () => null,
    loadConfig: async () => ({
      ...DEFAULT_CONFIG,
      display: { ...DEFAULT_CONFIG.display, showAccount: true },
    }),
    getAccountInfo: async () => {
      lookupCalls += 1;
      return { email: 'int@test.com', displayName: 'IntTest', orgName: 'IntOrg' };
    },
    render: (ctx) => { renderedContext = ctx; },
  });

  assert.equal(lookupCalls, 1);
  assert.deepEqual(renderedContext?.accountInfo, {
    email: 'int@test.com',
    displayName: 'IntTest',
    orgName: 'IntOrg',
  });
});

test('main skips getAccountInfo when showAccount is disabled', async () => {
  let lookupCalls = 0;

  await main({
    readStdin: async () => ({
      model: { display_name: 'Opus' },
      context_window: { context_window_size: 100, current_usage: { input_tokens: 10 } },
    }),
    parseTranscript: async () => ({ tools: [], agents: [], todos: [] }),
    countConfigs: async () => ({ claudeMdCount: 0, rulesCount: 0, mcpCount: 0, hooksCount: 0 }),
    getGitStatus: async () => null,
    getAccountInfo: async () => {
      lookupCalls += 1;
      return { email: 'skip@test.com' };
    },
    render: () => {},
  });

  assert.equal(lookupCalls, 0, 'should not call getAccountInfo when showAccount is false');
});
