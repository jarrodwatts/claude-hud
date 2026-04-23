import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadConfig,
  getConfigPath,
  mergeConfig,
  DEFAULT_CONFIG,
  DEFAULT_ELEMENT_ORDER,
  DEFAULT_MERGE_GROUPS,
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
  assert.ok(config.maxWidth === null || (typeof config.maxWidth === 'number' && config.maxWidth > 0), 'maxWidth should be null or a positive number');
  assert.ok(Array.isArray(config.elementOrder), 'elementOrder should be an array');
  assert.ok(config.elementOrder.length > 0, 'elementOrder should not be empty');
  assert.deepEqual(config.elementOrder, DEFAULT_ELEMENT_ORDER, 'elementOrder should default to the full expanded layout');

  // gitStatus object with expected properties
  assert.equal(typeof config.gitStatus, 'object');
  assert.equal(typeof config.gitStatus.enabled, 'boolean');
  assert.equal(typeof config.gitStatus.showDirty, 'boolean');
  assert.equal(typeof config.gitStatus.showAheadBehind, 'boolean');
  assert.ok(['truncate', 'wrap'].includes(config.gitStatus.branchOverflow), 'branchOverflow should be valid');
  assert.equal(typeof config.gitStatus.pushWarningThreshold, 'number');
  assert.equal(typeof config.gitStatus.pushCriticalThreshold, 'number');

  // display object with expected properties
  assert.equal(typeof config.display, 'object');
  assert.equal(typeof config.display.showModel, 'boolean');
  assert.equal(typeof config.display.showContextBar, 'boolean');
  assert.ok(['percent', 'tokens', 'remaining', 'both'].includes(config.display.contextValue), 'contextValue should be valid');
  assert.equal(typeof config.display.showConfigCounts, 'boolean');
  assert.equal(typeof config.display.showDuration, 'boolean');
  assert.equal(typeof config.display.showSpeed, 'boolean');
  assert.equal(typeof config.display.showTokenBreakdown, 'boolean');
  assert.equal(typeof config.display.showUsage, 'boolean');
  assert.equal(typeof config.display.showTools, 'boolean');
  assert.equal(typeof config.display.showAgents, 'boolean');
  assert.equal(typeof config.display.showTodos, 'boolean');
  assert.equal(typeof config.display.showSessionName, 'boolean');
  assert.equal(typeof config.display.showClaudeCodeVersion, 'boolean');
  assert.equal(typeof config.display.showMemoryUsage, 'boolean');
  assert.equal(typeof config.display.showPromptCache, 'boolean');
  assert.equal(typeof config.display.promptCacheTtlSeconds, 'number');
  assert.equal(typeof config.display.showCost, 'boolean');
  assert.equal(typeof config.display.showOutputStyle, 'boolean');
  assert.equal(typeof config.display.externalUsagePath, 'string');
  assert.equal(typeof config.display.externalUsageFreshnessMs, 'number');
  assert.ok(['full', 'compact', 'short'].includes(config.display.modelFormat), 'modelFormat should be valid');
  assert.equal(typeof config.display.modelOverride, 'string', 'modelOverride should be string');
  assert.equal(typeof config.colors, 'object');
  for (const key of ['context', 'usage', 'warning', 'usageWarning', 'critical', 'model', 'project', 'git', 'gitBranch', 'label', 'custom']) {
    const t = typeof config.colors[key];
    assert.ok(t === 'string' || t === 'number', `colors.${key} should be string or number, got ${t}`);
  }
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

test('mergeConfig defaults showClaudeCodeVersion to false', () => {
  const config = mergeConfig({});
  assert.equal(config.display.showClaudeCodeVersion, false);
  assert.equal(DEFAULT_CONFIG.display.showClaudeCodeVersion, false);
});

test('mergeConfig preserves explicit showClaudeCodeVersion=true', () => {
  const config = mergeConfig({ display: { showClaudeCodeVersion: true } });
  assert.equal(config.display.showClaudeCodeVersion, true);
});

test('mergeConfig defaults showMemoryUsage to false', () => {
  const config = mergeConfig({});
  assert.equal(config.display.showMemoryUsage, false);
  assert.equal(DEFAULT_CONFIG.display.showMemoryUsage, false);
});

test('mergeConfig preserves explicit showMemoryUsage=true', () => {
  const config = mergeConfig({ display: { showMemoryUsage: true } });
  assert.equal(config.display.showMemoryUsage, true);
});

test('mergeConfig defaults showPromptCache to false', () => {
  const config = mergeConfig({});
  assert.equal(config.display.showPromptCache, false);
  assert.equal(DEFAULT_CONFIG.display.showPromptCache, false);
});

test('mergeConfig preserves explicit showPromptCache=true', () => {
  const config = mergeConfig({ display: { showPromptCache: true } });
  assert.equal(config.display.showPromptCache, true);
});

test('mergeConfig defaults promptCacheTtlSeconds to 300', () => {
  const config = mergeConfig({});
  assert.equal(config.display.promptCacheTtlSeconds, 300);
  assert.equal(DEFAULT_CONFIG.display.promptCacheTtlSeconds, 300);
});

test('mergeConfig preserves valid promptCacheTtlSeconds values', () => {
  const config = mergeConfig({ display: { promptCacheTtlSeconds: 3600 } });
  assert.equal(config.display.promptCacheTtlSeconds, 3600);
});

test('mergeConfig falls back to default promptCacheTtlSeconds for invalid values', () => {
  assert.equal(mergeConfig({ display: { promptCacheTtlSeconds: 0 } }).display.promptCacheTtlSeconds, 300);
  assert.equal(mergeConfig({ display: { promptCacheTtlSeconds: -1 } }).display.promptCacheTtlSeconds, 300);
  assert.equal(mergeConfig({ display: { promptCacheTtlSeconds: 'fast' } }).display.promptCacheTtlSeconds, 300);
});

test('mergeConfig defaults showCost to false', () => {
  const config = mergeConfig({});
  assert.equal(config.display.showCost, false);
  assert.equal(DEFAULT_CONFIG.display.showCost, false);
});

test('mergeConfig preserves explicit showCost=true', () => {
  const config = mergeConfig({ display: { showCost: true } });
  assert.equal(config.display.showCost, true);
});

test('mergeConfig defaults git push thresholds to disabled', () => {
  const config = mergeConfig({});
  assert.equal(config.gitStatus.branchOverflow, 'truncate');
  assert.equal(config.gitStatus.pushWarningThreshold, 0);
  assert.equal(config.gitStatus.pushCriticalThreshold, 0);
});

test('mergeConfig preserves explicit git push thresholds', () => {
  const config = mergeConfig({
    gitStatus: { pushWarningThreshold: 15, pushCriticalThreshold: 30 },
  });
  assert.equal(config.gitStatus.pushWarningThreshold, 15);
  assert.equal(config.gitStatus.pushCriticalThreshold, 30);
});

test('mergeConfig defaults context thresholds to 70/85', () => {
  const config = mergeConfig({});
  assert.equal(config.display.contextWarningThreshold, 70);
  assert.equal(config.display.contextCriticalThreshold, 85);
});

test('mergeConfig preserves explicit context thresholds', () => {
  const config = mergeConfig({
    display: { contextWarningThreshold: 30, contextCriticalThreshold: 50 },
  });
  assert.equal(config.display.contextWarningThreshold, 30);
  assert.equal(config.display.contextCriticalThreshold, 50);
});

test('mergeConfig clamps context thresholds to 0-100', () => {
  const config = mergeConfig({
    display: { contextWarningThreshold: -10, contextCriticalThreshold: 150 },
  });
  assert.equal(config.display.contextWarningThreshold, 0);
  assert.equal(config.display.contextCriticalThreshold, 100);
});

test('mergeConfig falls back to defaults for invalid context thresholds', () => {
  const config = mergeConfig({
    display: { contextWarningThreshold: 'high', contextCriticalThreshold: null },
  });
  assert.equal(config.display.contextWarningThreshold, 70);
  assert.equal(config.display.contextCriticalThreshold, 85);
});

test('mergeConfig preserves valid git branch overflow modes', () => {
  assert.equal(mergeConfig({ gitStatus: { branchOverflow: 'wrap' } }).gitStatus.branchOverflow, 'wrap');
  assert.equal(mergeConfig({ gitStatus: { branchOverflow: 'truncate' } }).gitStatus.branchOverflow, 'truncate');
});

test('mergeConfig falls back to truncate for invalid git branch overflow values', () => {
  assert.equal(mergeConfig({ gitStatus: { branchOverflow: 'full' } }).gitStatus.branchOverflow, 'truncate');
  assert.equal(mergeConfig({ gitStatus: { branchOverflow: null } }).gitStatus.branchOverflow, 'truncate');
});

test('mergeConfig defaults showOutputStyle to false', () => {
  const config = mergeConfig({});
  assert.equal(config.display.showOutputStyle, false);
  assert.equal(DEFAULT_CONFIG.display.showOutputStyle, false);
});

test('mergeConfig preserves explicit showOutputStyle=true', () => {
  const config = mergeConfig({ display: { showOutputStyle: true } });
  assert.equal(config.display.showOutputStyle, true);
});

test('mergeConfig preserves customLine and truncates long values', () => {
  const customLine = 'x'.repeat(120);
  const config = mergeConfig({ display: { customLine } });
  assert.equal(config.display.customLine.length, 80);
  assert.equal(config.display.customLine, customLine.slice(0, 80));
});

test('mergeConfig defaults modelFormat to full', () => {
  const config = mergeConfig({});
  assert.equal(config.display.modelFormat, 'full');
});

test('mergeConfig preserves valid modelFormat values', () => {
  assert.equal(mergeConfig({ display: { modelFormat: 'compact' } }).display.modelFormat, 'compact');
  assert.equal(mergeConfig({ display: { modelFormat: 'short' } }).display.modelFormat, 'short');
  assert.equal(mergeConfig({ display: { modelFormat: 'full' } }).display.modelFormat, 'full');
});

test('mergeConfig falls back to full for invalid modelFormat', () => {
  assert.equal(mergeConfig({ display: { modelFormat: 'invalid' } }).display.modelFormat, 'full');
  assert.equal(mergeConfig({ display: { modelFormat: 123 } }).display.modelFormat, 'full');
  assert.equal(mergeConfig({ display: { modelFormat: null } }).display.modelFormat, 'full');
});

test('mergeConfig defaults modelOverride to empty string', () => {
  const config = mergeConfig({});
  assert.equal(config.display.modelOverride, '');
});

test('mergeConfig preserves modelOverride and truncates long values', () => {
  const override = 'x'.repeat(120);
  const config = mergeConfig({ display: { modelOverride: override } });
  assert.equal(config.display.modelOverride.length, 80);
  assert.equal(config.display.modelOverride, override.slice(0, 80));
});

test('mergeConfig defaults external usage fallback settings', () => {
  const config = mergeConfig({});
  assert.equal(config.display.externalUsagePath, '');
  assert.equal(config.display.externalUsageFreshnessMs, 300000);
});

test('mergeConfig preserves valid external usage fallback settings', () => {
  const config = mergeConfig({
    display: {
      externalUsagePath: ' /tmp/usage.json ',
      externalUsageFreshnessMs: 12345,
    },
  });
  assert.equal(config.display.externalUsagePath, '/tmp/usage.json');
  assert.equal(config.display.externalUsageFreshnessMs, 12345);
});

test('mergeConfig sanitizes invalid external usage fallback settings', () => {
  const config = mergeConfig({
    display: {
      externalUsagePath: 123,
      externalUsageFreshnessMs: -10,
    },
  });
  assert.equal(config.display.externalUsagePath, '');
  assert.equal(config.display.externalUsageFreshnessMs, 0);
});

test('mergeConfig falls back to empty for non-string modelOverride', () => {
  assert.equal(mergeConfig({ display: { modelOverride: 123 } }).display.modelOverride, '');
  assert.equal(mergeConfig({ display: { modelOverride: null } }).display.modelOverride, '');
  assert.equal(mergeConfig({ display: { modelOverride: true } }).display.modelOverride, '');
});

test('mergeConfig defaults maxWidth to null', () => {
  const config = mergeConfig({});
  assert.equal(config.maxWidth, null);
});

test('mergeConfig preserves valid maxWidth', () => {
  assert.equal(mergeConfig({ maxWidth: 50 }).maxWidth, 50);
  assert.equal(mergeConfig({ maxWidth: 80 }).maxWidth, 80);
  assert.equal(mergeConfig({ maxWidth: 30.7 }).maxWidth, 30);
});

test('mergeConfig rejects invalid maxWidth', () => {
  assert.equal(mergeConfig({ maxWidth: 0 }).maxWidth, null);
  assert.equal(mergeConfig({ maxWidth: -10 }).maxWidth, null);
  assert.equal(mergeConfig({ maxWidth: NaN }).maxWidth, null);
  assert.equal(mergeConfig({ maxWidth: 'wide' }).maxWidth, null);
  assert.equal(mergeConfig({ maxWidth: null }).maxWidth, null);
  assert.equal(mergeConfig({ maxWidth: Infinity }).maxWidth, null);
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

test('mergeConfig accepts contextValue=both', () => {
  const config = mergeConfig({
    display: {
      contextValue: 'both',
    },
  });
  assert.equal(config.display.contextValue, 'both');
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

test('mergeConfig defaults mergeGroups to context and usage', () => {
  const config = mergeConfig({});
  assert.deepEqual(config.display.mergeGroups, DEFAULT_MERGE_GROUPS);
  assert.deepEqual(DEFAULT_CONFIG.display.mergeGroups, DEFAULT_MERGE_GROUPS);
});

test('mergeConfig preserves explicit empty mergeGroups to disable merged lines', () => {
  const config = mergeConfig({
    display: {
      mergeGroups: [],
    },
  });
  assert.deepEqual(config.display.mergeGroups, []);
});

test('mergeConfig accepts valid mergeGroups and filters invalid entries', () => {
  const config = mergeConfig({
    display: {
      mergeGroups: [
        ['project', 'context', 'usage'],
        ['tools', 'todos', 'tools'],
        ['memory'],
        ['agents', 'unknown', 'environment'],
      ],
    },
  });

  assert.deepEqual(config.display.mergeGroups, [
    ['project', 'context', 'usage'],
    ['tools', 'todos'],
    ['agents', 'environment'],
  ]);
});

test('mergeConfig falls back to default mergeGroups when value is invalid', () => {
  assert.deepEqual(mergeConfig({ display: { mergeGroups: 'context,usage' } }).display.mergeGroups, DEFAULT_MERGE_GROUPS);
  assert.deepEqual(mergeConfig({ display: { mergeGroups: [['context'], ['unknown']] } }).display.mergeGroups, DEFAULT_MERGE_GROUPS);
  assert.deepEqual(mergeConfig({ display: { mergeGroups: [null] } }).display.mergeGroups, DEFAULT_MERGE_GROUPS);
});

test('mergeConfig preserves valid custom elementOrder including activity elements', () => {
  const config = mergeConfig({
    elementOrder: ['tools', 'project', 'usage', 'memory', 'context', 'agents', 'todos', 'environment'],
  });
  assert.deepEqual(
    config.elementOrder,
    ['tools', 'project', 'usage', 'memory', 'context', 'agents', 'todos', 'environment']
  );
});

test('mergeConfig filters unknown entries and de-duplicates elementOrder', () => {
  const config = mergeConfig({
    elementOrder: ['project', 'agents', 'project', 'banana', 'usage', 'memory', 'agents', 'context'],
  });
  assert.deepEqual(config.elementOrder, ['project', 'agents', 'usage', 'memory', 'context']);
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

test('mergeConfig defaults colors to expected semantic palette', () => {
  const config = mergeConfig({});
  assert.equal(config.colors.context, 'green');
  assert.equal(config.colors.usage, 'brightBlue');
  assert.equal(config.colors.warning, 'yellow');
  assert.equal(config.colors.usageWarning, 'brightMagenta');
  assert.equal(config.colors.critical, 'red');
  assert.equal(config.colors.model, 'cyan');
  assert.equal(config.colors.project, 'yellow');
  assert.equal(config.colors.git, 'magenta');
  assert.equal(config.colors.gitBranch, 'cyan');
  assert.equal(config.colors.label, 'dim');
  assert.equal(config.colors.custom, 208);
});

test('mergeConfig accepts valid color overrides and filters invalid values', () => {
  const config = mergeConfig({
    colors: {
      context: 'cyan',
      usage: 'magenta',
      warning: 'brightBlue',
      usageWarning: 'yellow',
      critical: 'not-a-color',
      model: 214,
      project: '#33ff00',
      git: 'cyan',
      gitBranch: 'not-a-color',
      label: 'dim',
      custom: '#ff6600',
    },
  });

  assert.equal(config.colors.context, 'cyan');
  assert.equal(config.colors.usage, 'magenta');
  assert.equal(config.colors.warning, 'brightBlue');
  assert.equal(config.colors.usageWarning, 'yellow');
  assert.equal(config.colors.critical, DEFAULT_CONFIG.colors.critical);
  assert.equal(config.colors.model, 214);
  assert.equal(config.colors.project, '#33ff00');
  assert.equal(config.colors.git, 'cyan');
  assert.equal(config.colors.gitBranch, DEFAULT_CONFIG.colors.gitBranch);
  assert.equal(config.colors.label, 'dim');
  assert.equal(config.colors.custom, '#ff6600');
});

// --- Custom colour value tests (256-colour and hex) ---

test('mergeConfig accepts 256-color index values', () => {
  const config = mergeConfig({
    colors: {
      context: 82,
      usage: 214,
      warning: 220,
      usageWarning: 97,
      critical: 196,
      model: 214,
      project: 82,
      git: 220,
      gitBranch: 45,
      label: 250,
      custom: 208,
    },
  });
  assert.equal(config.colors.context, 82);
  assert.equal(config.colors.usage, 214);
  assert.equal(config.colors.warning, 220);
  assert.equal(config.colors.usageWarning, 97);
  assert.equal(config.colors.critical, 196);
  assert.equal(config.colors.model, 214);
  assert.equal(config.colors.project, 82);
  assert.equal(config.colors.git, 220);
  assert.equal(config.colors.gitBranch, 45);
  assert.equal(config.colors.label, 250);
  assert.equal(config.colors.custom, 208);
});

test('mergeConfig accepts hex color strings', () => {
  const config = mergeConfig({
    colors: {
      context: '#33ff00',
      usage: '#FFB000',
      warning: '#ff87d7',
      label: '#abcdef',
      custom: '#ff6600',
    },
  });
  assert.equal(config.colors.context, '#33ff00');
  assert.equal(config.colors.usage, '#FFB000');
  assert.equal(config.colors.warning, '#ff87d7');
  assert.equal(config.colors.label, '#abcdef');
  assert.equal(config.colors.custom, '#ff6600');
});

test('mergeConfig accepts mixed named, 256-color, and hex values', () => {
  const config = mergeConfig({
    colors: {
      context: '#33ff00',
      usage: 214,
      warning: 'yellow',
      usageWarning: '#af87ff',
      critical: 'red',
      model: 214,
      project: '#33ff00',
      git: 'magenta',
      gitBranch: '#abcdef',
      label: 'dim',
      custom: 208,
    },
  });
  assert.equal(config.colors.context, '#33ff00');
  assert.equal(config.colors.usage, 214);
  assert.equal(config.colors.warning, 'yellow');
  assert.equal(config.colors.usageWarning, '#af87ff');
  assert.equal(config.colors.critical, 'red');
  assert.equal(config.colors.model, 214);
  assert.equal(config.colors.project, '#33ff00');
  assert.equal(config.colors.git, 'magenta');
  assert.equal(config.colors.gitBranch, '#abcdef');
  assert.equal(config.colors.label, 'dim');
  assert.equal(config.colors.custom, 208);
});

test('mergeConfig rejects invalid 256-color indices', () => {
  const config = mergeConfig({
    colors: {
      context: 256,
      usage: -1,
      warning: 1.5,
    },
  });
  assert.equal(config.colors.context, DEFAULT_CONFIG.colors.context);
  assert.equal(config.colors.usage, DEFAULT_CONFIG.colors.usage);
  assert.equal(config.colors.warning, DEFAULT_CONFIG.colors.warning);
});

test('mergeConfig rejects invalid hex strings', () => {
  const config = mergeConfig({
    colors: {
      context: '#fff',
      usage: '#gggggg',
      warning: 'ff0000',
    },
  });
  assert.equal(config.colors.context, DEFAULT_CONFIG.colors.context);
  assert.equal(config.colors.usage, DEFAULT_CONFIG.colors.usage);
  assert.equal(config.colors.warning, DEFAULT_CONFIG.colors.warning);
});
