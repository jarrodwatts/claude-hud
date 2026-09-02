import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { getClaudeConfigDir, getClaudeConfigJsonPath, getHudPluginDir } from '../dist/claude-config-dir.js';

function restoreEnvVar(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

test('getClaudeConfigJsonPath resolves to a sibling of ~/.claude when CLAUDE_CONFIG_DIR is unset', () => {
  const original = process.env.CLAUDE_CONFIG_DIR;
  try {
    delete process.env.CLAUDE_CONFIG_DIR;
    const homeDir = '/Users/example';
    assert.equal(getClaudeConfigDir(homeDir), path.join(homeDir, '.claude'));
    assert.equal(getClaudeConfigJsonPath(homeDir), path.join(homeDir, '.claude.json'));
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', original);
  }
});

test('getClaudeConfigJsonPath nests inside a custom CLAUDE_CONFIG_DIR instead of guessing a sibling file', () => {
  const original = process.env.CLAUDE_CONFIG_DIR;
  try {
    const homeDir = '/Users/example';
    const customDir = path.join(homeDir, '.claude-work');
    process.env.CLAUDE_CONFIG_DIR = customDir;

    assert.equal(getClaudeConfigDir(homeDir), customDir);
    // Regression guard: the old implementation string-concatenated `.json`
    // onto the directory path (`${customDir}.json`), which only happens to
    // exist for the default `~/.claude` profile. For any custom directory,
    // Claude Code actually nests the state file inside it.
    assert.equal(getClaudeConfigJsonPath(homeDir), path.join(customDir, '.claude.json'));
    assert.notEqual(getClaudeConfigJsonPath(homeDir), `${customDir}.json`);
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', original);
  }
});

test('getClaudeConfigJsonPath still resolves to the sibling path when CLAUDE_CONFIG_DIR is explicitly set to the default location', () => {
  // Some users set CLAUDE_CONFIG_DIR explicitly (e.g. a `claude1='CLAUDE_CONFIG_DIR=~/.claude command claude'`
  // alias) even though it resolves to the same place the default would. The
  // branch must key off the *resolved path*, not off whether the env var
  // string happens to be present, or this regresses to guessing a
  // nonexistent nested file for the default profile.
  const original = process.env.CLAUDE_CONFIG_DIR;
  try {
    const homeDir = '/Users/example';
    process.env.CLAUDE_CONFIG_DIR = path.join(homeDir, '.claude');

    assert.equal(getClaudeConfigJsonPath(homeDir), path.join(homeDir, '.claude.json'));
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', original);
  }
});

test('getClaudeConfigJsonPath nests correctly even when the custom dir is literally named .claude', () => {
  // A directory that happens to be *named* `.claude` but lives somewhere
  // other than directly under CLAUDE_CONFIG_DIR being unset must still use
  // the nested convention, since it was reached via an explicit env var.
  const original = process.env.CLAUDE_CONFIG_DIR;
  try {
    const homeDir = '/Users/example';
    const customDir = path.join(homeDir, 'profiles', '.claude');
    process.env.CLAUDE_CONFIG_DIR = customDir;

    assert.equal(getClaudeConfigJsonPath(homeDir), path.join(customDir, '.claude.json'));
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', original);
  }
});

test('getHudPluginDir stays nested under the resolved config dir in both modes', () => {
  const original = process.env.CLAUDE_CONFIG_DIR;
  try {
    const homeDir = '/Users/example';

    delete process.env.CLAUDE_CONFIG_DIR;
    assert.equal(getHudPluginDir(homeDir), path.join(homeDir, '.claude', 'plugins', 'claude-hud'));

    const customDir = path.join(homeDir, '.claude-work');
    process.env.CLAUDE_CONFIG_DIR = customDir;
    assert.equal(getHudPluginDir(homeDir), path.join(customDir, 'plugins', 'claude-hud'));
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', original);
  }
});
