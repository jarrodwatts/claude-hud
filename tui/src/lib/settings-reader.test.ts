import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  readSettings,
  readSettingsWithStatus,
  readSettingsAsync,
  readSettingsWithStatusAsync,
  SettingsReader,
} from './settings-reader.js';

describe('readSettings', () => {
  let tmpDir: string;
  let settingsPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hud-'));
    settingsPath = path.join(tmpDir, '.claude', 'settings.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when settings file is missing', async () => {
    expect(readSettings(settingsPath)).toBeNull();
  });

  it('parses plugin and MCP settings', async () => {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        model: 'claude-sonnet-4',
        enabledPlugins: {
          'plugin-a@1.0.0': true,
          'plugin-b': false,
          'plugin-c@2.0.0': true,
        },
        mcpServers: {
          'server-a': { type: 'sse', url: 'http://localhost' },
        },
        permissions: { allow: ['shell_command'] },
      }),
      'utf-8',
    );

    const data = readSettings(settingsPath);

    expect(data).not.toBeNull();
    expect(data?.model).toBe('claude-sonnet-4');
    expect(data?.pluginCount).toBe(2);
    expect(data?.pluginNames).toEqual(['plugin-a', 'plugin-c']);
    expect(data?.mcpCount).toBe(1);
    expect(data?.mcpNames).toEqual(['server-a']);
    expect(data?.allowedPermissions).toEqual(['shell_command']);
  });

  it('returns null for invalid JSON', () => {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, 'invalid json {', 'utf-8');

    const data = readSettings(settingsPath);

    expect(data).toBeNull();
  });

  it('returns an error status for invalid JSON', () => {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, 'invalid json {', 'utf-8');

    const result = readSettingsWithStatus(settingsPath);

    expect(result.data).toBeNull();
    expect(result.error).toBeDefined();
  });

  it('handles missing optional fields gracefully', () => {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({}), 'utf-8');

    const data = readSettings(settingsPath);

    expect(data).not.toBeNull();
    expect(data?.model).toBe('unknown');
    expect(data?.pluginCount).toBe(0);
    expect(data?.mcpCount).toBe(0);
    expect(data?.allowedPermissions).toEqual([]);
  });
});

describe('readSettingsAsync', () => {
  let tmpDir: string;
  let settingsPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hud-'));
    settingsPath = path.join(tmpDir, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads settings asynchronously', async () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ model: 'claude-opus-4' }), 'utf-8');

    const data = await readSettingsAsync(settingsPath);
    expect(data?.model).toBe('claude-opus-4');
  });

  it('returns null for missing file', async () => {
    const data = await readSettingsAsync('/nonexistent/path/settings.json');
    expect(data).toBeNull();
  });

  it('returns error for invalid JSON', async () => {
    fs.writeFileSync(settingsPath, '{invalid}', 'utf-8');

    const result = await readSettingsWithStatusAsync(settingsPath);
    expect(result.data).toBeNull();
    expect(result.error).toBeDefined();
  });
});

describe('SettingsReader', () => {
  let tmpDir: string;
  let settingsPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hud-'));
    settingsPath = path.join(tmpDir, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('uses cached data until forceRefresh is called', async () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ model: 'alpha', enabledPlugins: {} }), 'utf-8');

    const reader = new SettingsReader(settingsPath);

    const first = reader.read();
    expect(first?.model).toBe('alpha');

    fs.writeFileSync(settingsPath, JSON.stringify({ model: 'beta', enabledPlugins: {} }), 'utf-8');

    const cached = reader.read();
    expect(cached?.model).toBe('alpha');

    const refreshed = reader.forceRefresh();
    expect(refreshed?.model).toBe('beta');
  });

  it('readWithStatus returns cached data and error', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ model: 'gamma' }), 'utf-8');

    const reader = new SettingsReader(settingsPath);

    const result = reader.readWithStatus();
    expect(result.data?.model).toBe('gamma');
    expect(result.error).toBeUndefined();

    // #when cached, returns same result
    const cached = reader.readWithStatus();
    expect(cached.data?.model).toBe('gamma');
  });

  it('readWithStatusAsync returns cached data', async () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ model: 'delta' }), 'utf-8');

    const reader = new SettingsReader(settingsPath);

    const result = await reader.readWithStatusAsync();
    expect(result.data?.model).toBe('delta');

    // #when cached, returns same result
    const cached = await reader.readWithStatusAsync();
    expect(cached.data?.model).toBe('delta');
  });

  it('forceRefreshAsync updates cached data', async () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ model: 'initial' }), 'utf-8');

    const reader = new SettingsReader(settingsPath);
    reader.read();

    fs.writeFileSync(settingsPath, JSON.stringify({ model: 'updated' }), 'utf-8');

    const refreshed = await reader.forceRefreshAsync();
    expect(refreshed?.model).toBe('updated');
  });

  it('tracks error state', () => {
    fs.writeFileSync(settingsPath, '{invalid json}', 'utf-8');

    const reader = new SettingsReader(settingsPath);
    const result = reader.readWithStatus();

    expect(result.data).toBeNull();
    expect(result.error).toBeDefined();

    // #when cached error, returns same error
    const cached = reader.readWithStatus();
    expect(cached.error).toBeDefined();
  });
});
