import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadConfig,
  getConfigPath,
  mergeConfig,
  DEFAULT_CONFIG,
  DEFAULT_ELEMENT_ORDER,
} from '../dist/config.js';
import * as path from 'node:path';
import * as os from 'node:os';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

function restoreEnvVar(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

test('loadConfig returns valid config structure', async () => {
  const config = await loadConfig();

  // pathLevels must be 1, 2, or 3
  assert.ok([1, 2, 3].includes(config.pathLevels), 'pathLevels should be 1, 2, or 3');

  // lineLayout must be valid
  const validLineLayouts = ['compact', 'expanded'];
  assert.ok(validLineLayouts.includes(config.lineLayout), 'lineLayout should be valid');

  // showSeparators must be boolean
  assert.equal(typeof config.showSeparators, 'boolean', 'showSeparators should be boolean');
  assert.ok(Array.isArray(config.elementOrder), 'elementOrder should be an array');
  assert.ok(config.elementOrder.length > 0, 'elementOrder should not be empty');
  assert.deepEqual(config.elementOrder, DEFAULT_ELEMENT_ORDER, 'elementOrder should default to the full expanded layout');

  // gitStatus object with expected properties
  assert.equal(typeof config.gitStatus, 'object');
  assert.equal(typeof config.gitStatus.enabled, 'boolean');
  assert.equal(typeof config.gitStatus.showDirty, 'boolean');
  assert.equal(typeof config.gitStatus.showAheadBehind, 'boolean');

  // display object with expected properties
  assert.equal(typeof config.display, 'object');
  assert.equal(typeof config.display.showModel, 'boolean');
  assert.equal(typeof config.display.showContextBar, 'boolean');
  assert.ok(['percent', 'tokens', 'remaining'].includes(config.display.contextValue), 'contextValue should be valid');
  assert.equal(typeof config.display.showConfigCounts, 'boolean');
  assert.equal(typeof config.display.showDuration, 'boolean');
  assert.equal(typeof config.display.showSpeed, 'boolean');
  assert.equal(typeof config.display.showTokenBreakdown, 'boolean');
  assert.equal(typeof config.display.showUsage, 'boolean');
  assert.equal(typeof config.display.showTools, 'boolean');
  assert.equal(typeof config.display.showAgents, 'boolean');
  assert.equal(typeof config.display.showTodos, 'boolean');
  assert.equal(typeof config.display.showSessionName, 'boolean');
});

test('getConfigPath returns correct path', () => {
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  delete process.env.CLAUDE_CONFIG_DIR;

  try {
    const configPath = getConfigPath();
    const homeDir = os.homedir();
    assert.equal(configPath, path.join(homeDir, '.claude', 'plugins', 'claude-hud', 'config.json'));
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', originalConfigDir);
  }
});

test('mergeConfig defaults showSessionName to false', () => {
  const config = mergeConfig({});
  assert.equal(config.display.showSessionName, false);
  assert.equal(DEFAULT_CONFIG.display.showSessionName, false);
});

test('mergeConfig preserves explicit showSessionName=true', () => {
  const config = mergeConfig({ display: { showSessionName: true } });
  assert.equal(config.display.showSessionName, true);
});

test('getConfigPath respects CLAUDE_CONFIG_DIR', async () => {
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const customConfigDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-config-dir-'));

  try {
    process.env.CLAUDE_CONFIG_DIR = customConfigDir;
    const configPath = getConfigPath();
    assert.equal(configPath, path.join(customConfigDir, 'plugins', 'claude-hud', 'config.json'));
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', originalConfigDir);
    await rm(customConfigDir, { recursive: true, force: true });
  }
});

test('loadConfig reads user config from CLAUDE_CONFIG_DIR', async () => {
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const customConfigDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-config-load-'));

  try {
    process.env.CLAUDE_CONFIG_DIR = customConfigDir;
    const pluginDir = path.join(customConfigDir, 'plugins', 'claude-hud');
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      path.join(pluginDir, 'config.json'),
      JSON.stringify({
        lineLayout: 'compact',
        pathLevels: 2,
        display: { showSpeed: true },
      }),
      'utf8'
    );

    const config = await loadConfig();
    assert.equal(config.lineLayout, 'compact');
    assert.equal(config.pathLevels, 2);
    assert.equal(config.display.showSpeed, true);
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', originalConfigDir);
    await rm(customConfigDir, { recursive: true, force: true });
  }
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

test('mergeConfig accepts contextValue=remaining', () => {
  const config = mergeConfig({
    display: {
      contextValue: 'remaining',
    },
  });
  assert.equal(config.display.contextValue, 'remaining');
});

test('mergeConfig falls back to default for invalid contextValue', () => {
  const config = mergeConfig({
    display: {
      contextValue: 'invalid-mode',
    },
  });
  assert.equal(config.display.contextValue, DEFAULT_CONFIG.display.contextValue);
});

test('mergeConfig defaults elementOrder to the full expanded layout', () => {
  const config = mergeConfig({});
  assert.deepEqual(config.elementOrder, DEFAULT_ELEMENT_ORDER);
});

test('mergeConfig preserves valid custom elementOrder including activity elements', () => {
  const config = mergeConfig({
    elementOrder: ['tools', 'project', 'usage', 'context', 'agents', 'todos', 'environment'],
  });
  assert.deepEqual(
    config.elementOrder,
    ['tools', 'project', 'usage', 'context', 'agents', 'todos', 'environment']
  );
});

test('mergeConfig filters unknown entries and de-duplicates elementOrder', () => {
  const config = mergeConfig({
    elementOrder: ['project', 'agents', 'project', 'banana', 'usage', 'agents', 'context'],
  });
  assert.deepEqual(config.elementOrder, ['project', 'agents', 'usage', 'context']);
});

test('mergeConfig treats elementOrder as an explicit expanded-mode filter', () => {
  const config = mergeConfig({
    elementOrder: ['usage', 'project'],
  });
  assert.deepEqual(config.elementOrder, ['usage', 'project']);
});

test('mergeConfig falls back to default when elementOrder is empty or invalid', () => {
  assert.deepEqual(mergeConfig({ elementOrder: [] }).elementOrder, DEFAULT_ELEMENT_ORDER);
  assert.deepEqual(mergeConfig({ elementOrder: ['unknown'] }).elementOrder, DEFAULT_ELEMENT_ORDER);
  assert.deepEqual(mergeConfig({ elementOrder: 'project' }).elementOrder, DEFAULT_ELEMENT_ORDER);
});
