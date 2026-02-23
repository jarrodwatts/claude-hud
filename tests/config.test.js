import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, getConfigPath, mergeConfig, DEFAULT_CONFIG } from '../dist/config.js';
import * as path from 'node:path';
import * as os from 'node:os';

test('loadConfig returns valid config structure', async () => {
  const config = await loadConfig();

  // pathLevels must be 1, 2, or 3
  assert.ok([1, 2, 3].includes(config.pathLevels), 'pathLevels should be 1, 2, or 3');

  // lineLayout must be valid
  const validLineLayouts = ['compact', 'expanded'];
  assert.ok(validLineLayouts.includes(config.lineLayout), 'lineLayout should be valid');

  // showSeparators must be boolean
  assert.equal(typeof config.showSeparators, 'boolean', 'showSeparators should be boolean');

  // gitStatus object with expected properties
  assert.equal(typeof config.gitStatus, 'object');
  assert.equal(typeof config.gitStatus.enabled, 'boolean');
  assert.equal(typeof config.gitStatus.showDirty, 'boolean');
  assert.equal(typeof config.gitStatus.showAheadBehind, 'boolean');

  // display object with expected properties
  assert.equal(typeof config.display, 'object');
  assert.equal(typeof config.display.showModel, 'boolean');
  assert.equal(typeof config.display.showContextBar, 'boolean');
  assert.ok(['percent', 'tokens'].includes(config.display.contextValue), 'contextValue should be valid');
  assert.equal(typeof config.display.showConfigCounts, 'boolean');
  assert.equal(typeof config.display.showDuration, 'boolean');
  assert.equal(typeof config.display.showSpeed, 'boolean');
  assert.equal(typeof config.display.showTokenBreakdown, 'boolean');
  assert.equal(typeof config.display.showUsage, 'boolean');
  assert.equal(typeof config.display.showTools, 'boolean');
  assert.equal(typeof config.display.showAgents, 'boolean');
  assert.equal(typeof config.display.showTodos, 'boolean');
});

test('getConfigPath returns correct path', () => {
  const configPath = getConfigPath();
  const homeDir = os.homedir();
  assert.equal(configPath, path.join(homeDir, '.claude', 'plugins', 'claude-hud', 'config.json'));
});

// --- migrateConfig tests (via mergeConfig) ---

test('migrate legacy layout: "default" -> compact, no separators', () => {
  const config = mergeConfig({ layout: 'default' });
  assert.equal(config.lineLayout, 'compact');
  assert.equal(config.showSeparators, false);
});

test('migrate legacy layout: "separators" -> compact, with separators', () => {
  const config = mergeConfig({ layout: 'separators' });
  assert.equal(config.lineLayout, 'compact');
  assert.equal(config.showSeparators, true);
});

test('migrate object layout: extracts nested fields to top level', () => {
  const config = mergeConfig({
    layout: { lineLayout: 'expanded', showSeparators: true, pathLevels: 2 },
  });
  assert.equal(config.lineLayout, 'expanded');
  assert.equal(config.showSeparators, true);
  assert.equal(config.pathLevels, 2);
});

test('migrate object layout: empty object does not crash', () => {
  const config = mergeConfig({ layout: {} });
  // Should fall back to defaults since no fields were extracted
  assert.equal(config.lineLayout, DEFAULT_CONFIG.lineLayout);
  assert.equal(config.showSeparators, DEFAULT_CONFIG.showSeparators);
  assert.equal(config.pathLevels, DEFAULT_CONFIG.pathLevels);
});

test('no layout key -> no migration, uses defaults', () => {
  const config = mergeConfig({});
  assert.equal(config.lineLayout, DEFAULT_CONFIG.lineLayout);
  assert.equal(config.showSeparators, DEFAULT_CONFIG.showSeparators);
});

test('both layout and lineLayout present -> layout ignored', () => {
  const config = mergeConfig({ layout: 'separators', lineLayout: 'expanded' });
  // When lineLayout is already present, migration should not run
  assert.equal(config.lineLayout, 'expanded');
  assert.equal(config.showSeparators, DEFAULT_CONFIG.showSeparators);
});
