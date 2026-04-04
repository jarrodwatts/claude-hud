import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync, realpathSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  _getClaudeVersionInvocation,
  _parseClaudeCodeVersion,
  _resetVersionCache,
  _setExecFileImplForTests,
  _setResolveClaudeBinaryForTests,
  _setVersionInvocationEnvForTests,
  getClaudeCodeVersion,
} from '../dist/version.js';

function restoreEnvVar(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

afterEach(() => {
  _resetVersionCache();
  _setExecFileImplForTests(null);
  _setResolveClaudeBinaryForTests(null);
  _setVersionInvocationEnvForTests(null, null);
});

test('_parseClaudeCodeVersion preserves prerelease and build suffixes', () => {
  assert.equal(_parseClaudeCodeVersion('2.1.81 (Claude Code)\n'), '2.1.81');
  assert.equal(_parseClaudeCodeVersion('2.2.0-beta.1 (Claude Code)\n'), '2.2.0-beta.1');
  assert.equal(_parseClaudeCodeVersion('Claude Code 2.2.0-beta.1+abc123'), '2.2.0-beta.1+abc123');
  assert.equal(_parseClaudeCodeVersion(''), undefined);
});

test('_getClaudeVersionInvocation executes binaries directly on non-Windows', () => {
  const invocation = _getClaudeVersionInvocation('/usr/local/bin/claude', 'linux');
  assert.deepEqual(invocation, {
    file: '/usr/local/bin/claude',
    args: ['--version'],
  });
});

test('_getClaudeVersionInvocation wraps .cmd launches through COMSPEC on Windows', () => {
  const invocation = _getClaudeVersionInvocation(
    'C:\\Program Files\\Claude\\claude.cmd',
    'win32',
    'C:\\Windows\\System32\\cmd.exe'
  );
  assert.deepEqual(invocation, {
    file: 'C:\\Windows\\System32\\cmd.exe',
    args: ['/d', '/s', '/c', '"\"C:\\Program Files\\Claude\\claude.cmd\" --version"'],
  });
});

test('_getClaudeVersionInvocation executes .exe paths directly on Windows', () => {
  const invocation = _getClaudeVersionInvocation('C:\\Claude\\claude.exe', 'win32');
  assert.deepEqual(invocation, {
    file: 'C:\\Claude\\claude.exe',
    args: ['--version'],
  });
});

test('getClaudeCodeVersion persists cache across process resets under CLAUDE_CONFIG_DIR', async () => {
  const tempHome = await mkdtemp(path.join(tmpdir(), 'claude-hud-version-'));
  const customConfigDir = path.join(tempHome, '.claude-alt');
  const binaryPath = path.join(tempHome, 'claude');
  const originalHome = process.env.HOME;
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  let execCalls = 0;
  let resolveCalls = 0;

  process.env.HOME = tempHome;
  process.env.CLAUDE_CONFIG_DIR = customConfigDir;
  await writeFile(binaryPath, '#!/bin/sh\n', 'utf8');
  const binaryMtimeMs = 1710000000000;
  utimesSync(binaryPath, binaryMtimeMs / 1000, binaryMtimeMs / 1000);

  try {
    _setResolveClaudeBinaryForTests(() => {
      resolveCalls += 1;
      return { path: binaryPath, mtimeMs: binaryMtimeMs };
    });
    _setExecFileImplForTests(async () => {
      execCalls += 1;
      return { stdout: '2.2.0-beta.1+abc123 (Claude Code)\n' };
    });

    const first = await getClaudeCodeVersion();
    assert.equal(first, '2.2.0-beta.1+abc123');
    assert.equal(execCalls, 1);
    assert.equal(resolveCalls, 1);

    const cachePath = path.join(customConfigDir, 'plugins', 'claude-hud', '.claude-code-version-cache.json');
    assert.equal(existsSync(cachePath), true);

    _resetVersionCache();
    resolveCalls = 0;
    _setResolveClaudeBinaryForTests(() => {
      resolveCalls += 1;
      throw new Error('should not rescan PATH when disk cache is valid');
    });
    _setExecFileImplForTests(async () => {
      throw new Error('should not shell out when disk cache is valid');
    });

    const second = await getClaudeCodeVersion();
    assert.equal(second, '2.2.0-beta.1+abc123');
    assert.equal(execCalls, 1);
    assert.equal(resolveCalls, 0);
  } finally {
    restoreEnvVar('HOME', originalHome);
    restoreEnvVar('CLAUDE_CONFIG_DIR', originalConfigDir);
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('getClaudeCodeVersion refreshes when the Claude binary mtime changes', async () => {
  const tempHome = await mkdtemp(path.join(tmpdir(), 'claude-hud-version-invalidate-'));
  const customConfigDir = path.join(tempHome, '.claude-alt');
  const binaryPath = path.join(tempHome, 'claude');
  const originalHome = process.env.HOME;
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  let execCalls = 0;
  let currentMtimeMs = 1710000000000;

  process.env.HOME = tempHome;
  process.env.CLAUDE_CONFIG_DIR = customConfigDir;
  await writeFile(binaryPath, '#!/bin/sh\n', 'utf8');
  utimesSync(binaryPath, currentMtimeMs / 1000, currentMtimeMs / 1000);

  try {
    _setResolveClaudeBinaryForTests(() => ({ path: binaryPath, mtimeMs: currentMtimeMs }));
    _setExecFileImplForTests(async () => {
      execCalls += 1;
      return { stdout: execCalls === 1 ? '2.1.81 (Claude Code)\n' : '2.2.0-beta.1 (Claude Code)\n' };
    });

    const first = await getClaudeCodeVersion();
    assert.equal(first, '2.1.81');
    assert.equal(execCalls, 1);

    _resetVersionCache();
    currentMtimeMs += 1000;
    utimesSync(binaryPath, currentMtimeMs / 1000, currentMtimeMs / 1000);

    const second = await getClaudeCodeVersion();
    assert.equal(second, '2.2.0-beta.1');
    assert.equal(execCalls, 2);
  } finally {
    restoreEnvVar('HOME', originalHome);
    restoreEnvVar('CLAUDE_CONFIG_DIR', originalConfigDir);
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('getClaudeCodeVersion executes the resolved binary path', async () => {
  const tempHome = await mkdtemp(path.join(tmpdir(), 'claude-hud-version-windows-'));
  const customConfigDir = path.join(tempHome, '.claude-alt');
  const binaryPath = path.join(tempHome, 'claude.cmd');
  const originalHome = process.env.HOME;
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const execCalls = [];

  process.env.HOME = tempHome;
  process.env.CLAUDE_CONFIG_DIR = customConfigDir;
  await writeFile(binaryPath, '@echo off\r\n', 'utf8');
  const binaryMtimeMs = 1710000000000;
  utimesSync(binaryPath, binaryMtimeMs / 1000, binaryMtimeMs / 1000);

  try {
    const realBinaryPath = realpathSync(binaryPath);
    _setResolveClaudeBinaryForTests(() => ({ path: binaryPath, mtimeMs: binaryMtimeMs }));
    _setExecFileImplForTests(async (file) => {
      execCalls.push(file);
      return { stdout: '2.1.81 (Claude Code)\n' };
    });

    const version = await getClaudeCodeVersion();
    assert.equal(version, '2.1.81');
    assert.deepEqual(execCalls, [realBinaryPath]);
  } finally {
    restoreEnvVar('HOME', originalHome);
    restoreEnvVar('CLAUDE_CONFIG_DIR', originalConfigDir);
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('getClaudeCodeVersion uses the Windows wrapper invocation for .cmd binaries', async () => {
  const tempHome = await mkdtemp(path.join(tmpdir(), 'claude-hud-version-wrapper-'));
  const customConfigDir = path.join(tempHome, '.claude-alt');
  const binaryPath = path.join(tempHome, 'claude.cmd');
  const originalHome = process.env.HOME;
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const originalComspec = process.env.COMSPEC;
  const execCalls = [];

  process.env.HOME = tempHome;
  process.env.CLAUDE_CONFIG_DIR = customConfigDir;
  process.env.COMSPEC = 'C:\\Windows\\System32\\cmd.exe';
  await writeFile(binaryPath, '@echo off\r\n', 'utf8');
  const binaryMtimeMs = 1710000000000;
  utimesSync(binaryPath, binaryMtimeMs / 1000, binaryMtimeMs / 1000);

  try {
    const realBinaryPath = realpathSync(binaryPath);
    _setVersionInvocationEnvForTests(() => 'win32', () => 'C:\\Windows\\System32\\cmd.exe');
    _setResolveClaudeBinaryForTests(() => ({ path: binaryPath, mtimeMs: binaryMtimeMs }));
    _setExecFileImplForTests(async (file, args) => {
      execCalls.push({ file, args });
      return { stdout: '2.1.81 (Claude Code)\n' };
    });

    const version = await getClaudeCodeVersion();
    assert.equal(version, '2.1.81');
    const expectedInvocation = _getClaudeVersionInvocation(realBinaryPath, 'win32', 'C:\\Windows\\System32\\cmd.exe');
    assert.deepEqual(execCalls, [{
      file: expectedInvocation.file,
      args: expectedInvocation.args,
    }]);
  } finally {
    restoreEnvVar('HOME', originalHome);
    restoreEnvVar('CLAUDE_CONFIG_DIR', originalConfigDir);
    restoreEnvVar('COMSPEC', originalComspec);
    await rm(tempHome, { recursive: true, force: true });
  }
});
