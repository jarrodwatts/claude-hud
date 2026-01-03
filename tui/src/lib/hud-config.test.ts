import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  readHudConfig,
  readHudConfigWithStatus,
  readHudConfigAsync,
  readHudConfigWithStatusAsync,
  HudConfigReader,
} from './hud-config.js';

describe('readHudConfig', () => {
  it('filters invalid panel IDs and reads width', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hud-'));
    const configPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        panelOrder: ['status', 'tools', 'bogus'],
        hiddenPanels: ['cost', 'nope'],
        width: 52,
      }),
      'utf-8',
    );

    const config = readHudConfig(configPath);
    expect(config?.panelOrder).toEqual(['status', 'tools']);
    expect(config?.hiddenPanels).toEqual(['cost']);
    expect(config?.width).toBe(52);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns an error status for invalid JSON', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hud-'));
    const configPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configPath, '{not json}', 'utf-8');

    const result = readHudConfigWithStatus(configPath);
    expect(result.data).toBeNull();
    expect(result.error).toBeDefined();

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null for missing file', () => {
    const config = readHudConfig('/nonexistent/path/config.json');
    expect(config).toBeNull();
  });

  it('deduplicates panel IDs', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hud-'));
    const configPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        panelOrder: ['status', 'status', 'tools', 'status'],
      }),
      'utf-8',
    );

    const config = readHudConfig(configPath);
    expect(config?.panelOrder).toEqual(['status', 'tools']);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ignores non-positive width', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hud-'));
    const configPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ width: 0 }), 'utf-8');

    const config = readHudConfig(configPath);
    expect(config?.width).toBeUndefined();

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parses pricing configuration', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hud-'));
    const configPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        pricing: {
          sonnet: { input: 3, output: 15 },
          opus: { input: 15, output: 75 },
          haiku: { input: 0.25, output: 1.25 },
          lastUpdated: '2025-01-01',
        },
      }),
      'utf-8',
    );

    const config = readHudConfig(configPath);
    expect(config?.pricing?.sonnet).toEqual({ input: 3, output: 15 });
    expect(config?.pricing?.opus).toEqual({ input: 15, output: 75 });
    expect(config?.pricing?.haiku).toEqual({ input: 0.25, output: 1.25 });
    expect(config?.pricing?.lastUpdated).toBe('2025-01-01');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ignores malformed pricing', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hud-'));
    const configPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        pricing: {
          sonnet: 'not an object',
          opus: { input: 'not a number', output: 75 },
        },
      }),
      'utf-8',
    );

    const config = readHudConfig(configPath);
    expect(config?.pricing?.sonnet).toBeUndefined();
    expect(config?.pricing?.opus).toBeUndefined();

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('readHudConfigAsync', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hud-'));
    configPath = path.join(tmpDir, 'config.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads config asynchronously', async () => {
    fs.writeFileSync(configPath, JSON.stringify({ width: 60 }), 'utf-8');

    const config = await readHudConfigAsync(configPath);
    expect(config?.width).toBe(60);
  });

  it('returns null for missing file', async () => {
    const config = await readHudConfigAsync('/nonexistent/path/config.json');
    expect(config).toBeNull();
  });

  it('returns error status for invalid JSON', async () => {
    fs.writeFileSync(configPath, '{invalid}', 'utf-8');

    const result = await readHudConfigWithStatusAsync(configPath);
    expect(result.data).toBeNull();
    expect(result.error).toBeDefined();
  });
});

describe('HudConfigReader', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hud-'));
    configPath = path.join(tmpDir, 'config.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('caches data until refresh interval', () => {
    fs.writeFileSync(configPath, JSON.stringify({ width: 50 }), 'utf-8');

    const reader = new HudConfigReader(configPath);

    const first = reader.read();
    expect(first?.width).toBe(50);

    fs.writeFileSync(configPath, JSON.stringify({ width: 100 }), 'utf-8');

    const cached = reader.read();
    expect(cached?.width).toBe(50);
  });

  it('forceRefresh updates cached data', () => {
    fs.writeFileSync(configPath, JSON.stringify({ width: 50 }), 'utf-8');

    const reader = new HudConfigReader(configPath);
    reader.read();

    fs.writeFileSync(configPath, JSON.stringify({ width: 100 }), 'utf-8');

    const refreshed = reader.forceRefresh();
    expect(refreshed?.width).toBe(100);
  });

  it('forceRefreshAsync updates cached data', async () => {
    fs.writeFileSync(configPath, JSON.stringify({ width: 50 }), 'utf-8');

    const reader = new HudConfigReader(configPath);
    reader.read();

    fs.writeFileSync(configPath, JSON.stringify({ width: 100 }), 'utf-8');

    const refreshed = await reader.forceRefreshAsync();
    expect(refreshed?.width).toBe(100);
  });

  it('readWithStatus returns cached data and error', () => {
    fs.writeFileSync(configPath, JSON.stringify({ width: 50 }), 'utf-8');

    const reader = new HudConfigReader(configPath);

    const result = reader.readWithStatus();
    expect(result.data?.width).toBe(50);
    expect(result.error).toBeUndefined();

    const cached = reader.readWithStatus();
    expect(cached.data?.width).toBe(50);
  });

  it('readWithStatusAsync returns cached data', async () => {
    fs.writeFileSync(configPath, JSON.stringify({ width: 50 }), 'utf-8');

    const reader = new HudConfigReader(configPath);

    const result = await reader.readWithStatusAsync();
    expect(result.data?.width).toBe(50);

    const cached = await reader.readWithStatusAsync();
    expect(cached.data?.width).toBe(50);
  });

  it('tracks error state', () => {
    fs.writeFileSync(configPath, '{invalid json}', 'utf-8');

    const reader = new HudConfigReader(configPath);
    const result = reader.readWithStatus();

    expect(result.data).toBeNull();
    expect(result.error).toBeDefined();

    const cached = reader.readWithStatus();
    expect(cached.error).toBeDefined();
  });
});
