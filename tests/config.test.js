import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, DEFAULT_CONFIG, getConfigPath } from '../dist/config.js';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';

test('loadConfig returns valid config structure', async () => {
  const config = await loadConfig();
  // Should return valid pathLevels (1, 2, or 3)
  assert.ok([1, 2, 3].includes(config.pathLevels), 'pathLevels should be 1, 2, or 3');
  // Should have gitStatus object with expected properties
  assert.equal(typeof config.gitStatus, 'object');
  assert.equal(typeof config.gitStatus.enabled, 'boolean');
  assert.equal(typeof config.gitStatus.showDirty, 'boolean');
  assert.equal(typeof config.gitStatus.showAheadBehind, 'boolean');
  // Should have display object with expected properties
  assert.equal(typeof config.display, 'object');
  assert.equal(typeof config.display.showModel, 'boolean');
  assert.equal(typeof config.display.showContextBar, 'boolean');
});

test('getConfigPath returns correct path', () => {
  const configPath = getConfigPath();
  const homeDir = os.homedir();
  assert.equal(configPath, path.join(homeDir, '.claude', 'plugins', 'claude-hud', 'config.json'));
});

test('DEFAULT_CONFIG has correct structure', () => {
  assert.equal(DEFAULT_CONFIG.pathLevels, 1);
  assert.equal(typeof DEFAULT_CONFIG.gitStatus, 'object');
  assert.equal(DEFAULT_CONFIG.gitStatus.enabled, true);
});

test('pathLevels can be 1, 2, or 3', () => {
  assert.ok([1, 2, 3].includes(DEFAULT_CONFIG.pathLevels));
});
