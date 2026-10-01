import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as os from 'node:os';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import {
  loadConfig,
  getConfigPath,
  getConfigOverridePath,
  mergeConfig,
  DEFAULT_CONFIG,
  DEFAULT_ELEMENT_ORDER,
  DEFAULT_MERGE_GROUPS,
} from '../dist/config.js';

function withPath(keyPath, value) {
  const keys = keyPath.split('.');
  const root = {};
  let node = root;
  for (const key of keys.slice(0, -1)) node = node[key] = {};
  node[keys.at(-1)] = value;
  return root;
}

function getPath(config, keyPath) {
  return keyPath.split('.').reduce((node, key) => node[key], config);
}

function booleanPaths(node, prefix = '') {
  return Object.entries(node).flatMap(([key, value]) => {
    if (typeof value === 'boolean') return [prefix + key];
    if (value && typeof value === 'object' && !Array.isArray(value)) return booleanPaths(value, `${prefix}${key}.`);
    return [];
  });
}

async function withConfigDir(fn) {
  const original = process.env.CLAUDE_CONFIG_DIR;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'claude-hud-config-'));
  process.env.CLAUDE_CONFIG_DIR = dir;
  try {
    return await fn(dir);
  } finally {
    if (original === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = original;
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
}

async function trySymlink(t, target, linkPath, type) {
  try {
    await symlink(target, linkPath, type);
    return true;
  } catch (err) {
    if (err?.code === 'EPERM' || err?.code === 'EACCES') {
      t.skip('symlinks are unavailable on this platform');
      return false;
    }
    throw err;
  }
}

test('mergeConfig fills every key from DEFAULT_CONFIG and ignores unknown or malformed sections', () => {
  assert.deepEqual(mergeConfig({}), DEFAULT_CONFIG);
  assert.deepEqual(mergeConfig({ bogus: 1, display: 'nope', colors: [], gitStatus: null }), DEFAULT_CONFIG);
});

test('mergeConfig returns copies that do not alias the defaults', () => {
  const config = mergeConfig({});
  config.elementOrder.push('tools');
  config.display.mergeGroups[0].push('tools');
  assert.deepEqual(DEFAULT_CONFIG.elementOrder, DEFAULT_ELEMENT_ORDER);
  assert.deepEqual(DEFAULT_CONFIG.display.mergeGroups, DEFAULT_MERGE_GROUPS);
});

test('boolean options accept only booleans', () => {
  for (const keyPath of booleanPaths(DEFAULT_CONFIG)) {
    const fallback = getPath(DEFAULT_CONFIG, keyPath);
    assert.equal(getPath(mergeConfig(withPath(keyPath, !fallback)), keyPath), !fallback, keyPath);
    assert.equal(getPath(mergeConfig(withPath(keyPath, 'true')), keyPath), fallback, keyPath);
  }
});

test('enum options accept only their listed values', () => {
  const enums = {
    language: ['en', 'zh', 'zh-Hans', 'zh-Hant', 'zh-TW'],
    lineLayout: ['compact', 'expanded'],
    pathLevels: [1, 2, 3, 'full'],
    'gitStatus.branchOverflow': ['truncate', 'wrap'],
    'display.addedDirsLayout': ['inline', 'line'],
    'display.contextValue': ['percent', 'tokens', 'remaining', 'both'],
    'display.usageValue': ['percent', 'remaining'],
    'display.effortFormat': ['full', 'symbol', 'text'],
    'display.modelFormat': ['full', 'compact', 'short'],
    'display.modelSource': ['auto', 'stdin', 'transcript'],
    'display.customLinePosition': ['first', 'last'],
    'display.timeFormat': ['relative', 'absolute', 'both', 'elapsed', 'elapsedAndAbsolute'],
    'display.hourCycle': ['auto', 'h11', 'h12', 'h23', 'h24'],
  };
  for (const [keyPath, allowed] of Object.entries(enums)) {
    for (const value of allowed) assert.equal(getPath(mergeConfig(withPath(keyPath, value)), keyPath), value, keyPath);
    for (const value of ['bogus', 4, null]) {
      assert.equal(getPath(mergeConfig(withPath(keyPath, value)), keyPath), getPath(DEFAULT_CONFIG, keyPath), keyPath);
    }
  }
});

test('numeric options clamp, floor, or reject per key', () => {
  const cases = [
    ['maxWidth', 30.7, 30],
    ['maxWidth', 5000, 1000],
    ['maxWidth', 0, null],
    ['maxWidth', Infinity, null],
    ['maxWidth', 'wide', null],
    ['gitStatus.pushWarningThreshold', 2.9, 2],
    ['gitStatus.pushCriticalThreshold', -3, 0],
    ['gitStatus.pushCriticalThreshold', '5', 0],
    ['display.contextWarningThreshold', 150, 100],
    ['display.contextCriticalThreshold', -5, 0],
    ['display.usageThreshold', 42.5, 42.5],
    ['display.sevenDayThreshold', NaN, 80],
    ['display.environmentThreshold', '50', 0],
    ['display.toolsMaxVisible', 0, 0],
    ['display.toolsMaxVisible', 2.5, 4],
    ['display.skillsMaxVisible', -1, 4],
    ['display.toolNameMaxLength', 12, 12],
    ['display.authUserLength', '8', 8],
    ['display.externalUsageFreshnessMs', -10, 0],
    ['display.externalUsageFreshnessMs', 1234.5, 1234],
    ['display.autoCompactWindow', 160000, 160000],
    ['display.autoCompactWindow', 1.5, null],
    ['display.autoCompactWindow', 0, null],
  ];
  for (const [keyPath, input, expected] of cases) {
    assert.equal(getPath(mergeConfig(withPath(keyPath, input)), keyPath), expected, `${keyPath}=${input}`);
  }
});

test('display text options are sanitized and capped', () => {
  const config = mergeConfig({
    display: {
      customLine: '\u001b]8;;https://evil.invalid\u0007click\u001b]8;;\u0007',
      providerName: `\u001b[31m${'P'.repeat(60)}\u001b[0m`,
      modelOverride: 'Model‮ spoof',
      advisorOverride: `Advisor\n${'x'.repeat(100)}`,
    },
  });
  assert.equal(config.display.customLine, 'click');
  assert.equal(config.display.providerName, 'P'.repeat(40));
  assert.equal(config.display.modelOverride, 'Model spoof');
  assert.equal(config.display.advisorOverride, `Advisor${'x'.repeat(73)}`);
  assert.equal(mergeConfig({ display: { modelOverride: 123 } }).display.modelOverride, '');
});

test('external usage paths trim, expand ~ and ${VAR} once, and leave unset variables', () => {
  process.env.CLAUDE_HUD_TEST_A = '/opt/claude-hud';
  process.env.CLAUDE_HUD_TEST_B = '${CLAUDE_HUD_TEST_A}';
  delete process.env.CLAUDE_HUD_TEST_MISSING;
  try {
    const { display } = mergeConfig({
      display: { externalUsagePath: ' ~/usage.json ', externalUsageWritePath: '${CLAUDE_HUD_TEST_A}/${CLAUDE_HUD_TEST_B}' },
    });
    assert.equal(display.externalUsagePath, path.join(os.homedir(), 'usage.json'));
    assert.equal(display.externalUsageWritePath, '/opt/claude-hud/${CLAUDE_HUD_TEST_A}');
    assert.equal(
      mergeConfig({ display: { externalUsagePath: '${CLAUDE_HUD_TEST_MISSING}/u.json' } }).display.externalUsagePath,
      '${CLAUDE_HUD_TEST_MISSING}/u.json',
    );
    assert.equal(mergeConfig({ display: { externalUsagePath: 123 } }).display.externalUsagePath, '');
  } finally {
    delete process.env.CLAUDE_HUD_TEST_A;
    delete process.env.CLAUDE_HUD_TEST_B;
  }
});

test('element lists keep known names once, in order', () => {
  const names = ['project', 'agents', 'project', 'banana', 7, 'usage'];
  assert.deepEqual(mergeConfig({ elementOrder: names }).elementOrder, ['project', 'agents', 'usage']);
  assert.deepEqual(mergeConfig({ display: { rightAlign: names } }).display.rightAlign, ['project', 'agents', 'usage']);
  assert.deepEqual(
    mergeConfig({ projectLineOrder: ['cost', 'model', 'cost', 'bogus'] }).projectLineOrder,
    ['cost', 'model'],
  );

  // elementOrder must keep at least one element; the others may be empty.
  for (const value of [[], ['unknown'], 'project']) {
    assert.deepEqual(mergeConfig({ elementOrder: value }).elementOrder, DEFAULT_ELEMENT_ORDER);
  }
  assert.deepEqual(mergeConfig({ projectLineOrder: ['bogus'] }).projectLineOrder, []);
  assert.deepEqual(mergeConfig({ display: { rightAlign: 'context' } }).display.rightAlign, []);
});

test('mergeGroups need two known elements and never reuse an element', () => {
  const groups = [
    ['project', 'context', 'usage'],
    ['tools', 'todos', 'tools'],
    ['memory'],
    ['agents', 'unknown', 'context', 'environment'],
  ];
  assert.deepEqual(mergeConfig({ display: { mergeGroups: groups } }).display.mergeGroups, [
    ['project', 'context', 'usage'],
    ['tools', 'todos'],
    ['agents', 'environment'],
  ]);
  assert.deepEqual(mergeConfig({ display: { mergeGroups: [] } }).display.mergeGroups, []);
  for (const value of ['context,usage', [['context'], ['unknown']], [null]]) {
    assert.deepEqual(mergeConfig({ display: { mergeGroups: value } }).display.mergeGroups, DEFAULT_MERGE_GROUPS);
  }
});

test('colors accept named presets, 0-255 indices, and #rrggbb', () => {
  const accepted = ['cyan', 'brightMagenta', 0, 214, 255, '#33ff00', '#FFB000'];
  const rejected = ['not-a-color', 256, -1, 1.5, '#fff', '#gggggg', 'ff0000', null];
  for (const value of accepted) assert.equal(mergeConfig({ colors: { context: value } }).colors.context, value);
  for (const value of rejected) {
    assert.equal(mergeConfig({ colors: { gitBranch: value } }).colors.gitBranch, DEFAULT_CONFIG.colors.gitBranch);
  }
});

test('bar characters must be exactly one visible grapheme', () => {
  for (const value of ['●', '中', '★', '🟢']) {
    assert.equal(mergeConfig({ colors: { barFilled: value } }).colors.barFilled, value);
  }
  const rejected = [
    '', 'ab', 123, '\n', '\x1b', '\x80', '‮', '​', '﻿', '­', ' ',
    '️', String.fromCodePoint(0xe0100), '﷐', 'a‮', '⭐️',
    '\u{1F468}‍\u{1F469}‍\u{1F467}',
  ];
  for (const value of rejected) {
    assert.equal(mergeConfig({ colors: { barEmpty: value } }).colors.barEmpty, DEFAULT_CONFIG.colors.barEmpty, JSON.stringify(value));
  }
});

test('legacy layout keys migrate unless lineLayout is set', () => {
  assert.deepEqual(
    [mergeConfig({ layout: 'default' }).lineLayout, mergeConfig({ layout: 'default' }).showSeparators],
    ['compact', false],
  );
  assert.equal(mergeConfig({ layout: 'separators' }).showSeparators, true);

  const fromObject = mergeConfig({ layout: { lineLayout: 'expanded', showSeparators: true, pathLevels: 2 } });
  assert.deepEqual([fromObject.lineLayout, fromObject.showSeparators, fromObject.pathLevels], ['expanded', true, 2]);
  assert.equal(mergeConfig({ layout: {} }).lineLayout, DEFAULT_CONFIG.lineLayout);

  const explicit = mergeConfig({ layout: 'separators', lineLayout: 'expanded' });
  assert.deepEqual([explicit.lineLayout, explicit.showSeparators], ['expanded', false]);
});

test('config paths follow CLAUDE_CONFIG_DIR, with the override outside plugins/', async () => {
  await withConfigDir(async (dir) => {
    assert.equal(getConfigPath(), path.join(dir, 'plugins', 'claude-hud', 'config.json'));
    assert.equal(getConfigOverridePath(), path.join(dir, 'claude-hud.json'));
  });
  const original = process.env.CLAUDE_CONFIG_DIR;
  delete process.env.CLAUDE_CONFIG_DIR;
  try {
    assert.equal(getConfigPath(), path.join(os.homedir(), '.claude', 'plugins', 'claude-hud', 'config.json'));
    assert.equal(getConfigOverridePath(), path.join(os.homedir(), '.claude', 'claude-hud.json'));
  } finally {
    if (original !== undefined) process.env.CLAUDE_CONFIG_DIR = original;
  }
});

test('loadConfig layers claude-hud.json over the shared config', async () => {
  await withConfigDir(async (dir) => {
    assert.deepEqual(await loadConfig(), DEFAULT_CONFIG);

    await writeJson(path.join(dir, 'claude-hud.json'), { display: { customLine: 'Override only' } });
    assert.equal((await loadConfig()).display.customLine, 'Override only');

    await writeJson(getConfigPath(), {
      lineLayout: 'compact',
      elementOrder: ['project', 'context'],
      display: { customLine: 'shared', showSpeed: true },
    });
    await writeJson(path.join(dir, 'claude-hud.json'), { elementOrder: ['project'], display: { customLine: 'Work' } });
    const config = await loadConfig();
    assert.equal(config.display.customLine, 'Work');
    assert.equal(config.display.showSpeed, true, 'sibling keys survive');
    assert.equal(config.lineLayout, 'compact', 'untouched top-level keys survive');
    assert.deepEqual(config.elementOrder, ['project'], 'arrays replace');
  });
});

test('loadConfig ignores malformed, unsafe, oversized, and symlinked files', async (t) => {
  await withConfigDir(async (dir) => {
    const overridePath = path.join(dir, 'claude-hud.json');
    await writeJson(getConfigPath(), { display: { customLine: 'shared' } });

    let nested = { display: { customLine: 'poison' } };
    for (let depth = 0; depth < 10; depth += 1) nested = { nested };
    const badOverrides = [
      '{ not json',
      '["Work Team"]',
      '{"display":{"__proto__":{"customLine":"poison"}}}',
      JSON.stringify(nested),
      JSON.stringify({ display: { customLine: 'poison' }, padding: 'x'.repeat(70 * 1024) }),
    ];
    for (const content of badOverrides) {
      await writeJson(overridePath, content);
      assert.equal((await loadConfig()).display.customLine, 'shared', content.slice(0, 40));
    }

    await rm(overridePath);
    const target = path.join(dir, 'target.json');
    await writeJson(target, { display: { customLine: 'poison' } });
    if (!(await trySymlink(t, target, overridePath, 'file'))) return;
    assert.equal((await loadConfig()).display.customLine, 'shared');

    await rm(getConfigPath());
    if (!(await trySymlink(t, target, getConfigPath(), 'file'))) return;
    assert.equal((await loadConfig()).display.customLine, '');
  });
});

test('loadConfig keeps overrides isolated when config directories share plugins/', async (t) => {
  const original = process.env.CLAUDE_CONFIG_DIR;
  const root = await mkdtemp(path.join(os.tmpdir(), 'claude-hud-shared-plugins-'));
  try {
    const sharedPlugins = path.join(root, 'shared', 'plugins');
    await writeJson(path.join(sharedPlugins, 'claude-hud', 'config.json'), { lineLayout: 'compact' });
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    const configs = {};
    for (const name of ['work', 'personal']) {
      const dir = path.join(root, name);
      await mkdir(dir, { recursive: true });
      if (!(await trySymlink(t, sharedPlugins, path.join(dir, 'plugins'), linkType))) return;
      await writeJson(path.join(dir, 'claude-hud.json'), { display: { customLine: name } });
      process.env.CLAUDE_CONFIG_DIR = dir;
      configs[name] = await loadConfig();
    }
    assert.equal(configs.work.display.customLine, 'work');
    assert.equal(configs.personal.display.customLine, 'personal');
    assert.equal(configs.personal.lineLayout, 'compact');
  } finally {
    if (original === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = original;
    await rm(root, { recursive: true, force: true });
  }
});
