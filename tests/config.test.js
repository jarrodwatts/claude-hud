import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, DEFAULT_CONFIG, getConfigPath } from '../dist/config.js';
import * as path from 'node:path';
import * as os from 'node:os';

test('loadConfig returns default config when file does not exist', async () => {
  const config = await loadConfig();
  assert.equal(config.pathLevels, 1);
  assert.equal(config.gitStatus.enabled, true);
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
