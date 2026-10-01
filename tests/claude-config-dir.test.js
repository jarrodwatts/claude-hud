import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { getClaudeConfigDir, getClaudeConfigJsonPath } from '../dist/claude-config-dir.js';

function restoreEnvVar(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

test('getClaudeConfigJsonPath returns ~/.claude.json without CLAUDE_CONFIG_DIR', () => {
  const original = process.env.CLAUDE_CONFIG_DIR;
  delete process.env.CLAUDE_CONFIG_DIR;
  try {
    // The file sits BESIDE the default ~/.claude directory, not inside it.
    assert.equal(getClaudeConfigJsonPath('/home/user'), path.join('/home/user', '.claude.json'));
    assert.equal(getClaudeConfigDir('/home/user'), path.join('/home/user', '.claude'));
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', original);
  }
});

test('getClaudeConfigJsonPath returns .claude.json inside CLAUDE_CONFIG_DIR', () => {
  const original = process.env.CLAUDE_CONFIG_DIR;
  try {
    process.env.CLAUDE_CONFIG_DIR = '/home/user/.claude-use/identities/work';
    // Claude Code keeps the file INSIDE the overridden directory; appending ".json" to the directory itself (identities/work.json) is the wrong file.
    assert.equal(
      getClaudeConfigJsonPath('/home/user'),
      path.join('/home/user/.claude-use/identities/work', '.claude.json'),
    );
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', original);
  }
});

test('getClaudeConfigJsonPath expands ~ and trims whitespace in CLAUDE_CONFIG_DIR', () => {
  const original = process.env.CLAUDE_CONFIG_DIR;
  try {
    process.env.CLAUDE_CONFIG_DIR = '  ~/.claude-use/identities/work ';
    assert.equal(
      getClaudeConfigJsonPath('/home/user'),
      path.join('/home/user/.claude-use/identities/work', '.claude.json'),
    );
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', original);
  }
});
