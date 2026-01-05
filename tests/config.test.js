import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, DEFAULT_CONFIG, getConfigPath } from '../dist/config.js';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';

// Helper to create a temporary config for testing
function createTempConfig(configData) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hud-test-'));
  const configDir = path.join(tempDir, '.claude', 'plugins', 'claude-hud');
  fs.mkdirSync(configDir, { recursive: true });
  const configPath = path.join(configDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(configData));
  return { tempDir, configPath, cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }) };
}

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

// DEFAULT_CONFIG comprehensive tests
describe('DEFAULT_CONFIG', () => {
  test('has layout set to default', () => {
    assert.equal(DEFAULT_CONFIG.layout, 'default');
  });

  test('has all gitStatus properties', () => {
    assert.equal(DEFAULT_CONFIG.gitStatus.enabled, true);
    assert.equal(DEFAULT_CONFIG.gitStatus.showDirty, true);
    assert.equal(DEFAULT_CONFIG.gitStatus.showAheadBehind, false);
  });

  test('has all display properties', () => {
    assert.equal(DEFAULT_CONFIG.display.showModel, true);
    assert.equal(DEFAULT_CONFIG.display.showContextBar, true);
    assert.equal(DEFAULT_CONFIG.display.showConfigCounts, true);
    assert.equal(DEFAULT_CONFIG.display.showDuration, true);
    assert.equal(DEFAULT_CONFIG.display.showTokenBreakdown, true);
    assert.equal(DEFAULT_CONFIG.display.showTools, true);
    assert.equal(DEFAULT_CONFIG.display.showAgents, true);
    assert.equal(DEFAULT_CONFIG.display.showTodos, true);
  });
});

// Layout validation tests
describe('layout validation', () => {
  test('accepts default layout', () => {
    assert.equal(DEFAULT_CONFIG.layout, 'default');
  });

  test('layout must be one of valid values', () => {
    const validLayouts = ['default', 'condensed', 'separators'];
    assert.ok(validLayouts.includes(DEFAULT_CONFIG.layout));
  });
});

// PathLevels validation tests
describe('pathLevels validation', () => {
  test('pathLevels is 1 by default', () => {
    assert.equal(DEFAULT_CONFIG.pathLevels, 1);
  });

  test('pathLevels must be 1, 2, or 3', () => {
    const validLevels = [1, 2, 3];
    assert.ok(validLevels.includes(DEFAULT_CONFIG.pathLevels));
  });
});

// Git status configuration tests
describe('gitStatus configuration', () => {
  test('enabled is true by default', () => {
    assert.equal(DEFAULT_CONFIG.gitStatus.enabled, true);
  });

  test('showDirty is true by default', () => {
    assert.equal(DEFAULT_CONFIG.gitStatus.showDirty, true);
  });

  test('showAheadBehind is false by default', () => {
    assert.equal(DEFAULT_CONFIG.gitStatus.showAheadBehind, false);
  });
});

// Display configuration tests
describe('display configuration', () => {
  test('all display options are booleans', () => {
    const displayOptions = Object.values(DEFAULT_CONFIG.display);
    displayOptions.forEach(value => {
      assert.equal(typeof value, 'boolean');
    });
  });

  test('all display options default to true', () => {
    const displayOptions = Object.values(DEFAULT_CONFIG.display);
    displayOptions.forEach(value => {
      assert.equal(value, true);
    });
  });

  test('has exactly 8 display options', () => {
    const optionCount = Object.keys(DEFAULT_CONFIG.display).length;
    assert.equal(optionCount, 8);
  });
});

// Config loading behavior tests
describe('loadConfig behavior', () => {
  test('returns complete config with all required fields', async () => {
    const config = await loadConfig();

    // Check top-level fields exist
    assert.ok('layout' in config);
    assert.ok('pathLevels' in config);
    assert.ok('gitStatus' in config);
    assert.ok('display' in config);

    // Check gitStatus fields
    assert.ok('enabled' in config.gitStatus);
    assert.ok('showDirty' in config.gitStatus);
    assert.ok('showAheadBehind' in config.gitStatus);

    // Check display fields
    assert.ok('showModel' in config.display);
    assert.ok('showContextBar' in config.display);
    assert.ok('showConfigCounts' in config.display);
    assert.ok('showDuration' in config.display);
    assert.ok('showTokenBreakdown' in config.display);
    assert.ok('showTools' in config.display);
    assert.ok('showAgents' in config.display);
    assert.ok('showTodos' in config.display);
  });

  test('returns valid layout value', async () => {
    const config = await loadConfig();
    const validLayouts = ['default', 'condensed', 'separators'];
    assert.ok(validLayouts.includes(config.layout));
  });

  test('returns valid pathLevels value', async () => {
    const config = await loadConfig();
    assert.ok([1, 2, 3].includes(config.pathLevels));
  });
});

// Config path tests
describe('getConfigPath', () => {
  test('returns path under home directory', () => {
    const configPath = getConfigPath();
    const homeDir = os.homedir();
    assert.ok(configPath.startsWith(homeDir));
  });

  test('returns path with .claude directory', () => {
    const configPath = getConfigPath();
    assert.ok(configPath.includes('.claude'));
  });

  test('returns path with plugins/claude-hud', () => {
    const configPath = getConfigPath();
    assert.ok(configPath.includes(path.join('plugins', 'claude-hud')));
  });

  test('returns path ending with config.json', () => {
    const configPath = getConfigPath();
    assert.ok(configPath.endsWith('config.json'));
  });
});
