import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  getHudPluginDir,
  getLegacyHudPluginDir,
  migrateDataDirIfNeeded,
} from '../dist/claude-config-dir.js';

function restoreEnvVar(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

test('getHudPluginDir returns legacy path when CLAUDE_PLUGIN_DATA is not set', () => {
  const saved = process.env.CLAUDE_PLUGIN_DATA;
  delete process.env.CLAUDE_PLUGIN_DATA;
  try {
    const result = getHudPluginDir('/home/user');
    assert.equal(result, path.join('/home/user', '.claude', 'plugins', 'claude-hud'));
  } finally {
    restoreEnvVar('CLAUDE_PLUGIN_DATA', saved);
  }
});

test('getHudPluginDir returns CLAUDE_PLUGIN_DATA when set', () => {
  const saved = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = '/custom/plugin/data';
  try {
    const result = getHudPluginDir('/home/user');
    assert.equal(result, '/custom/plugin/data');
  } finally {
    restoreEnvVar('CLAUDE_PLUGIN_DATA', saved);
  }
});

test('getHudPluginDir ignores empty CLAUDE_PLUGIN_DATA', () => {
  const saved = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = '   ';
  try {
    const result = getHudPluginDir('/home/user');
    assert.equal(result, path.join('/home/user', '.claude', 'plugins', 'claude-hud'));
  } finally {
    restoreEnvVar('CLAUDE_PLUGIN_DATA', saved);
  }
});

test('getHudPluginDir expands ~ in CLAUDE_PLUGIN_DATA', () => {
  const saved = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = '~/my-plugin-data';
  try {
    const result = getHudPluginDir('/home/user');
    assert.equal(result, path.join('/home/user', 'my-plugin-data'));
  } finally {
    restoreEnvVar('CLAUDE_PLUGIN_DATA', saved);
  }
});

test('getLegacyHudPluginDir always returns legacy path', () => {
  const saved = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = '/custom/path';
  try {
    const result = getLegacyHudPluginDir('/home/user');
    assert.equal(result, path.join('/home/user', '.claude', 'plugins', 'claude-hud'));
  } finally {
    restoreEnvVar('CLAUDE_PLUGIN_DATA', saved);
  }
});

test('migrateDataDirIfNeeded moves legacy dir to new location', async () => {
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'hud-migrate-'));
  const saved = process.env.CLAUDE_PLUGIN_DATA;
  const savedConfig = process.env.CLAUDE_CONFIG_DIR;

  try {
    // Set up legacy dir with a test file
    const legacyDir = path.join(tmpDir, '.claude', 'plugins', 'claude-hud');
    await mkdir(legacyDir, { recursive: true });
    await writeFile(path.join(legacyDir, 'config.json'), '{"test":true}');

    // Set new target
    const newDir = path.join(tmpDir, 'new-data');
    delete process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_PLUGIN_DATA = newDir;

    migrateDataDirIfNeeded(tmpDir);

    // Old dir should be gone, new dir should have the file
    assert.equal(fs.existsSync(legacyDir), false, 'legacy dir should be removed');
    assert.equal(fs.existsSync(newDir), true, 'new dir should exist');
    assert.equal(
      fs.readFileSync(path.join(newDir, 'config.json'), 'utf8'),
      '{"test":true}',
    );
  } finally {
    restoreEnvVar('CLAUDE_PLUGIN_DATA', saved);
    restoreEnvVar('CLAUDE_CONFIG_DIR', savedConfig);
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('migrateDataDirIfNeeded no-ops when CLAUDE_PLUGIN_DATA is not set', async () => {
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'hud-migrate-'));
  const saved = process.env.CLAUDE_PLUGIN_DATA;
  const savedConfig = process.env.CLAUDE_CONFIG_DIR;

  try {
    const legacyDir = path.join(tmpDir, '.claude', 'plugins', 'claude-hud');
    await mkdir(legacyDir, { recursive: true });
    await writeFile(path.join(legacyDir, 'config.json'), '{"test":true}');

    delete process.env.CLAUDE_PLUGIN_DATA;
    delete process.env.CLAUDE_CONFIG_DIR;

    migrateDataDirIfNeeded(tmpDir);

    // Legacy dir should still exist (no migration needed, paths are the same)
    assert.equal(fs.existsSync(legacyDir), true, 'legacy dir should remain');
  } finally {
    restoreEnvVar('CLAUDE_PLUGIN_DATA', saved);
    restoreEnvVar('CLAUDE_CONFIG_DIR', savedConfig);
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('migrateDataDirIfNeeded no-ops when new dir already exists', async () => {
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'hud-migrate-'));
  const saved = process.env.CLAUDE_PLUGIN_DATA;
  const savedConfig = process.env.CLAUDE_CONFIG_DIR;

  try {
    const legacyDir = path.join(tmpDir, '.claude', 'plugins', 'claude-hud');
    await mkdir(legacyDir, { recursive: true });
    await writeFile(path.join(legacyDir, 'config.json'), '{"old":true}');

    const newDir = path.join(tmpDir, 'new-data');
    await mkdir(newDir, { recursive: true });
    await writeFile(path.join(newDir, 'config.json'), '{"new":true}');

    delete process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_PLUGIN_DATA = newDir;

    migrateDataDirIfNeeded(tmpDir);

    // Both should remain untouched
    assert.equal(
      fs.readFileSync(path.join(newDir, 'config.json'), 'utf8'),
      '{"new":true}',
      'new dir should not be overwritten',
    );
    assert.equal(fs.existsSync(legacyDir), true, 'legacy dir should remain');
  } finally {
    restoreEnvVar('CLAUDE_PLUGIN_DATA', saved);
    restoreEnvVar('CLAUDE_CONFIG_DIR', savedConfig);
    await rm(tmpDir, { recursive: true, force: true });
  }
});
