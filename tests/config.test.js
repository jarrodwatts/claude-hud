import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadConfig,
  getConfigPath,
  mergeConfig,
  DEFAULT_CONFIG,
  DEFAULT_ELEMENT_ORDER,
  DEFAULT_MERGE_GROUPS,
  DEFAULT_PROJECT_LINE_ORDER,
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

  // pathLevels must be 1, 2, 3, or 'full'
  assert.ok([1, 2, 3, 'full'].includes(config.pathLevels), 'pathLevels should be 1, 2, 3, or "full"');

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
  assert.ok(['percent', 'remaining'].includes(config.display.usageValue), 'usageValue should be valid');
  assert.equal(typeof config.display.showTools, 'boolean');
  assert.equal(typeof config.display.showAgents, 'boolean');
  assert.equal(typeof config.display.showTodos, 'boolean');
  assert.equal(typeof config.display.showSessionName, 'boolean');
  assert.equal(typeof config.display.showClaudeCodeVersion, 'boolean');
  assert.equal(typeof config.display.showMemoryUsage, 'boolean');
  assert.equal(typeof config.display.showPromptCache, 'boolean');
  assert.equal(typeof config.display.promptCacheTtlSeconds, 'number');
  assert.equal(typeof config.display.showCost, 'boolean');
  assert.equal(typeof config.display.showRoutedCost, 'boolean');
  assert.equal(typeof config.display.showOutputStyle, 'boolean');
  assert.equal(typeof config.display.externalUsagePath, 'string');
  assert.equal(typeof config.display.externalUsageFreshnessMs, 'number');
  assert.ok(['full', 'compact', 'short'].includes(config.display.modelFormat), 'modelFormat should be valid');
  assert.equal(typeof config.display.modelOverride, 'string', 'modelOverride should be string');
  assert.ok(['stdin', 'auto', 'transcript'].includes(config.display.modelSource), 'modelSource should be valid');
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

test('mergeConfig defaults forceMaxWidth to false', () => {
  const config = mergeConfig({});
  assert.equal(config.forceMaxWidth, false);
  assert.equal(DEFAULT_CONFIG.forceMaxWidth, false);
});

test('mergeConfig preserves explicit forceMaxWidth=true', () => {
  const config = mergeConfig({ forceMaxWidth: true });
  assert.equal(config.forceMaxWidth, true);
});

test('mergeConfig falls back to false for invalid forceMaxWidth values', () => {
  assert.equal(mergeConfig({ forceMaxWidth: 'yes' }).forceMaxWidth, false);
  assert.equal(mergeConfig({ forceMaxWidth: 1 }).forceMaxWidth, false);
});


test('mergeConfig preserves explicit showSessionName=true', () => {
  const config = mergeConfig({ display: { showSessionName: true } });
  assert.equal(config.display.showSessionName, true);
});

test('mergeConfig defaults provider options to off/empty', () => {
  const config = mergeConfig({});
  assert.equal(config.display.showProvider, false);
  assert.equal(config.display.providerName, '');
  assert.equal(DEFAULT_CONFIG.display.showProvider, false);
});

test('mergeConfig preserves provider options and caps providerName length', () => {
  const config = mergeConfig({ display: { showProvider: true, providerName: 'x'.repeat(60) } });
  assert.equal(config.display.showProvider, true);
  assert.equal(config.display.providerName.length, 40);
});

test('mergeConfig defaults showRoutedCost to false', () => {
  const config = mergeConfig({});
  assert.equal(config.display.showRoutedCost, false);
  assert.equal(DEFAULT_CONFIG.display.showRoutedCost, false);
});

test('mergeConfig preserves explicit showRoutedCost=true', () => {
  const config = mergeConfig({ display: { showRoutedCost: true } });
  assert.equal(config.display.showRoutedCost, true);
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

test('mergeConfig defaults display thresholds from DEFAULT_CONFIG', () => {
  const config = mergeConfig({});
  assert.equal(config.display.usageThreshold, DEFAULT_CONFIG.display.usageThreshold);
  assert.equal(config.display.sevenDayThreshold, DEFAULT_CONFIG.display.sevenDayThreshold);
  assert.equal(config.display.environmentThreshold, DEFAULT_CONFIG.display.environmentThreshold);
});

test('mergeConfig preserves and clamps explicit display thresholds', () => {
  const config = mergeConfig({
    display: { usageThreshold: -10, sevenDayThreshold: 42, environmentThreshold: 150 },
  });
  assert.equal(config.display.usageThreshold, 0);
  assert.equal(config.display.sevenDayThreshold, 42);
  assert.equal(config.display.environmentThreshold, 100);
});

test('mergeConfig falls back to defaults for invalid display thresholds', () => {
  const config = mergeConfig({
    display: { usageThreshold: 'always', sevenDayThreshold: Number.NaN, environmentThreshold: null },
  });
  assert.equal(config.display.usageThreshold, DEFAULT_CONFIG.display.usageThreshold);
  assert.equal(config.display.sevenDayThreshold, DEFAULT_CONFIG.display.sevenDayThreshold);
  assert.equal(config.display.environmentThreshold, DEFAULT_CONFIG.display.environmentThreshold);
  assert.equal(
    mergeConfig({ display: { sevenDayThreshold: Number.POSITIVE_INFINITY } }).display.sevenDayThreshold,
    DEFAULT_CONFIG.display.sevenDayThreshold,
  );
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

test('mergeConfig defaults customLinePosition to last', () => {
  const config = mergeConfig({});
  assert.equal(config.display.customLinePosition, 'last');
});

test('mergeConfig preserves explicit customLinePosition', () => {
  const config = mergeConfig({ display: { customLinePosition: 'first' } });
  assert.equal(config.display.customLinePosition, 'first');
});

test('mergeConfig falls back to last for invalid customLinePosition', () => {
  const config = mergeConfig({ display: { customLinePosition: 'middle' } });
  assert.equal(config.display.customLinePosition, 'last');
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

test('mergeConfig defaults modelSource to stdin', () => {
  assert.equal(DEFAULT_CONFIG.display.modelSource, 'stdin');
  assert.equal(mergeConfig({}).display.modelSource, 'stdin');
});

test('mergeConfig preserves valid modelSource values', () => {
  assert.equal(mergeConfig({ display: { modelSource: 'stdin' } }).display.modelSource, 'stdin');
  assert.equal(mergeConfig({ display: { modelSource: 'auto' } }).display.modelSource, 'auto');
  assert.equal(mergeConfig({ display: { modelSource: 'transcript' } }).display.modelSource, 'transcript');
});

test('mergeConfig falls back to stdin for invalid modelSource values', () => {
  assert.equal(mergeConfig({ display: { modelSource: 'proxy' } }).display.modelSource, 'stdin');
  assert.equal(mergeConfig({ display: { modelSource: 42 } }).display.modelSource, 'stdin');
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

test('mergeConfig accepts pathLevels: "full"', () => {
  const config = mergeConfig({ pathLevels: 'full' });
  assert.equal(config.pathLevels, 'full');
});

test('mergeConfig rejects invalid pathLevels, falls back to default', () => {
  const config = mergeConfig({ pathLevels: 4 });
  assert.equal(config.pathLevels, DEFAULT_CONFIG.pathLevels);
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

test('mergeConfig accepts usageValue=remaining', () => {
  const config = mergeConfig({
    display: {
      usageValue: 'remaining',
    },
  });
  assert.equal(config.display.usageValue, 'remaining');
});

test('mergeConfig falls back to default for invalid usageValue', () => {
  const config = mergeConfig({
    display: {
      usageValue: 'tokens',
    },
  });
  assert.equal(config.display.usageValue, DEFAULT_CONFIG.display.usageValue);
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

test('mergeConfig accepts valid single-character barFilled and barEmpty', () => {
  const config = mergeConfig({
    colors: { barFilled: '●', barEmpty: '○' },
  });
  assert.equal(config.colors.barFilled, '●');
  assert.equal(config.colors.barEmpty, '○');
});

test('mergeConfig accepts surrogate-pair emoji for bar chars', () => {
  const config = mergeConfig({
    colors: { barFilled: '🟢', barEmpty: '🔴' },
  });
  assert.equal(config.colors.barFilled, '🟢');
  assert.equal(config.colors.barEmpty, '🔴');
});

test('mergeConfig accepts CJK and Unicode symbols for bar chars', () => {
  const config = mergeConfig({
    colors: { barFilled: '中', barEmpty: '★' },
  });
  assert.equal(config.colors.barFilled, '中');
  assert.equal(config.colors.barEmpty, '★');
});

test('mergeConfig rejects control characters for bar chars', () => {
  const config = mergeConfig({
    colors: { barFilled: '\n', barEmpty: '\x1b' },
  });
  assert.equal(config.colors.barFilled, DEFAULT_CONFIG.colors.barFilled);
  assert.equal(config.colors.barEmpty, DEFAULT_CONFIG.colors.barEmpty);
});

test('mergeConfig rejects C1 control characters for bar chars', () => {
  const config = mergeConfig({
    colors: { barFilled: '\x80', barEmpty: '\x9f' },
  });
  assert.equal(config.colors.barFilled, DEFAULT_CONFIG.colors.barFilled);
  assert.equal(config.colors.barEmpty, DEFAULT_CONFIG.colors.barEmpty);
});

test('mergeConfig rejects multi-character strings for bar chars', () => {
  const config = mergeConfig({
    colors: { barFilled: 'ab', barEmpty: '##' },
  });
  assert.equal(config.colors.barFilled, DEFAULT_CONFIG.colors.barFilled);
  assert.equal(config.colors.barEmpty, DEFAULT_CONFIG.colors.barEmpty);
});

test('mergeConfig rejects non-string types for bar chars', () => {
  const config = mergeConfig({
    colors: { barFilled: 123, barEmpty: true },
  });
  assert.equal(config.colors.barFilled, DEFAULT_CONFIG.colors.barFilled);
  assert.equal(config.colors.barEmpty, DEFAULT_CONFIG.colors.barEmpty);
});

test('mergeConfig rejects bidirectional control characters for bar chars', () => {
  const bidiChars = ['‮', '‎', '‏', '‪', '‫', '‬', '‭', '⁦', '⁩'];
  for (const ch of bidiChars) {
    const config = mergeConfig({ colors: { barFilled: ch } });
    assert.equal(config.colors.barFilled, DEFAULT_CONFIG.colors.barFilled,
      `should reject U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
  }
});

test('mergeConfig rejects zero-width characters for bar chars', () => {
  const zwChars = ['​', '‌', '‍', '﻿'];
  for (const ch of zwChars) {
    const config = mergeConfig({ colors: { barFilled: ch } });
    assert.equal(config.colors.barFilled, DEFAULT_CONFIG.colors.barFilled,
      `should reject U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
  }
});

test('mergeConfig rejects variation selectors for bar chars', () => {
  assert.equal(mergeConfig({ colors: { barFilled: '︀' } }).colors.barFilled, DEFAULT_CONFIG.colors.barFilled);
  assert.equal(mergeConfig({ colors: { barFilled: '️' } }).colors.barFilled, DEFAULT_CONFIG.colors.barFilled);
  assert.equal(mergeConfig({ colors: { barFilled: String.fromCodePoint(0xE0100) } }).colors.barFilled, DEFAULT_CONFIG.colors.barFilled);
});

test('mergeConfig rejects other invisible format characters for bar chars', () => {
  const formatChars = ['­', '؜', '⁠'];
  for (const ch of formatChars) {
    const config = mergeConfig({ colors: { barFilled: ch } });
    assert.equal(config.colors.barFilled, DEFAULT_CONFIG.colors.barFilled,
      `should reject U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
  }
});

test('mergeConfig rejects compound emoji with zero-width joiners for bar chars', () => {
  const config = mergeConfig({ colors: { barFilled: '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}' } });
  assert.equal(config.colors.barFilled, DEFAULT_CONFIG.colors.barFilled);
});

test('mergeConfig rejects invisible code points attached to visible bar chars', () => {
  assert.equal(mergeConfig({ colors: { barFilled: 'a\u202e' } }).colors.barFilled, DEFAULT_CONFIG.colors.barFilled);
  assert.equal(mergeConfig({ colors: { barFilled: '⭐\ufe0f' } }).colors.barFilled, DEFAULT_CONFIG.colors.barFilled);
});

test('mergeConfig rejects empty string for bar chars', () => {
  const config = mergeConfig({ colors: { barFilled: '', barEmpty: '' } });
  assert.equal(config.colors.barFilled, DEFAULT_CONFIG.colors.barFilled);
  assert.equal(config.colors.barEmpty, DEFAULT_CONFIG.colors.barEmpty);
});

test('mergeConfig rejects line and paragraph separators for bar chars', () => {
  assert.equal(mergeConfig({ colors: { barFilled: ' ' } }).colors.barFilled, DEFAULT_CONFIG.colors.barFilled);
  assert.equal(mergeConfig({ colors: { barFilled: ' ' } }).colors.barFilled, DEFAULT_CONFIG.colors.barFilled);
});

test('mergeConfig rejects Unicode noncharacters for bar chars', () => {
  assert.equal(mergeConfig({ colors: { barFilled: '﷐' } }).colors.barFilled, DEFAULT_CONFIG.colors.barFilled);
  assert.equal(mergeConfig({ colors: { barFilled: '￾' } }).colors.barFilled, DEFAULT_CONFIG.colors.barFilled);
  assert.equal(mergeConfig({ colors: { barFilled: '￿' } }).colors.barFilled, DEFAULT_CONFIG.colors.barFilled);
});

test('mergeConfig independently validates barFilled and barEmpty', () => {
  const config = mergeConfig({ colors: { barFilled: '█', barEmpty: '‮' } });
  assert.equal(config.colors.barFilled, '█');
  assert.equal(config.colors.barEmpty, DEFAULT_CONFIG.colors.barEmpty);
});

test('mergeConfig defaults showAdvisor to false', () => {
  const config = mergeConfig({});
  assert.equal(config.display.showAdvisor, false);
  assert.equal(DEFAULT_CONFIG.display.showAdvisor, false);
});

test('mergeConfig defaults showCompactions to false', () => {
  const config = mergeConfig({});
  assert.equal(config.display.showCompactions, false);
  assert.equal(DEFAULT_CONFIG.display.showCompactions, false);
});

test('mergeConfig preserves explicit showCompactions=true', () => {
  const config = mergeConfig({ display: { showCompactions: true } });
  assert.equal(config.display.showCompactions, true);
});

test('mergeConfig rejects non-boolean showCompactions', () => {
  const config = mergeConfig({ display: { showCompactions: 'yes' } });
  assert.equal(config.display.showCompactions, false);
});

test('mergeConfig preserves explicit showAdvisor=true', () => {
  const config = mergeConfig({ display: { showAdvisor: true } });
  assert.equal(config.display.showAdvisor, true);
});

test('mergeConfig defaults advisorOverride to empty string', () => {
  const config = mergeConfig({});
  assert.equal(config.display.advisorOverride, '');
});

test('mergeConfig preserves explicit advisorOverride and caps at 80 chars', () => {
  const config = mergeConfig({ display: { advisorOverride: 'Opus 4.7 (custom)' } });
  assert.equal(config.display.advisorOverride, 'Opus 4.7 (custom)');

  const longValue = 'x'.repeat(120);
  const capped = mergeConfig({ display: { advisorOverride: longValue } });
  assert.equal(capped.display.advisorOverride.length, 80);
});

test('mergeConfig rejects non-string advisorOverride and non-boolean showAdvisor', () => {
  const config = mergeConfig({ display: { showAdvisor: 'yes', advisorOverride: 42 } });
  assert.equal(config.display.showAdvisor, false);
  assert.equal(config.display.advisorOverride, '');
});

test('mergeConfig defaults projectLineOrder to no reordering', () => {
  const config = mergeConfig({});
  assert.deepEqual(config.projectLineOrder, DEFAULT_PROJECT_LINE_ORDER);
  assert.deepEqual(DEFAULT_CONFIG.projectLineOrder, DEFAULT_PROJECT_LINE_ORDER);
});

test('mergeConfig falls back to default when projectLineOrder is missing or invalid', () => {
  assert.deepEqual(mergeConfig({ projectLineOrder: 'model' }).projectLineOrder, DEFAULT_PROJECT_LINE_ORDER);
  assert.deepEqual(mergeConfig({ projectLineOrder: 42 }).projectLineOrder, DEFAULT_PROJECT_LINE_ORDER);
  assert.deepEqual(mergeConfig({ projectLineOrder: null }).projectLineOrder, DEFAULT_PROJECT_LINE_ORDER);
  assert.deepEqual(mergeConfig({ projectLineOrder: [] }).projectLineOrder, DEFAULT_PROJECT_LINE_ORDER);
  assert.deepEqual(mergeConfig({ projectLineOrder: ['banana', 7, null] }).projectLineOrder, DEFAULT_PROJECT_LINE_ORDER);
});

test('mergeConfig preserves a full custom projectLineOrder', () => {
  const reversed = ['auth', 'speed', 'cost', 'duration', 'extra', 'version', 'sessionName', 'advisor', 'project', 'model'];
  const config = mergeConfig({ projectLineOrder: reversed });
  assert.deepEqual(config.projectLineOrder, reversed);
});

test('mergeConfig preserves a partial projectLineOrder as an explicit prefix', () => {
  const config = mergeConfig({ projectLineOrder: ['project', 'model'] });
  assert.deepEqual(config.projectLineOrder, ['project', 'model']);

  const authFirst = mergeConfig({ projectLineOrder: ['auth'] });
  assert.deepEqual(authFirst.projectLineOrder, ['auth']);
});

test('mergeConfig filters unknown entries and de-duplicates projectLineOrder', () => {
  const config = mergeConfig({ projectLineOrder: ['project', 'banana', 'model', 'project', 'cost'] });
  assert.deepEqual(config.projectLineOrder, [
    'project',
    'model',
    'cost',
  ]);
});
