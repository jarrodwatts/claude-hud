import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstat, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const launcher = fileURLToPath(new URL('../scripts/statusline.mjs', import.meta.url));
const hud = fileURLToPath(new URL('../hud.mjs', import.meta.url));
const install = (args, options) => run(hud, ['install', ...args], options);

async function withConfigDir(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'hud-setup-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const run = (file, args, { configDir, pluginsDir, cwd, columns } = {}) => spawnSync(process.execPath, [file, ...args], {
  cwd,
  encoding: 'utf8',
  env: {
    ...process.env,
    CLAUDE_CONFIG_DIR: configDir,
    CLAUDE_CODE_PLUGIN_CACHE_DIR: pluginsDir ?? '',
    COLUMNS: columns ?? '',
  },
});

async function fakeInstall(configDir, version, pluginsDir = path.join(configDir, 'plugins')) {
  const dist = path.join(pluginsDir, 'cache', 'market', 'claude-hud', version, 'dist');
  await mkdir(dist, { recursive: true });
  await writeFile(path.join(dist, '..', 'package.json'), '{"type":"module"}');
  await writeFile(
    path.join(dist, 'index.js'),
    `export async function main() { console.log('${version} ' + process.env.COLUMNS); }\n`,
  );
}

test('launcher runs the newest installed version and pads COLUMNS', async () => {
  await withConfigDir(async (configDir) => {
    await fakeInstall(configDir, '0.9.0');
    await fakeInstall(configDir, '0.10.0');
    await mkdir(path.join(configDir, 'plugins', 'cache', 'market', 'claude-hud', '0.11.0'), { recursive: true });

    const result = run(launcher, [], { configDir, columns: '120' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '0.10.0 116');
  });
});

test('launcher looks only in the plugins root CLAUDE_CODE_PLUGIN_CACHE_DIR names', async () => {
  await withConfigDir(async (configDir) => {
    const pluginsDir = path.join(configDir, 'relocated');
    await fakeInstall(configDir, '0.9.0', pluginsDir);
    await fakeInstall(configDir, '0.10.0');

    const result = run(launcher, [], { configDir, pluginsDir, columns: '120' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '0.9.0 116');
  });
});

test('launcher exits quietly with no install and never runs a cwd-relative dist', async () => {
  await withConfigDir(async (configDir) => {
    await mkdir(path.join(configDir, 'dist'), { recursive: true });
    await writeFile(path.join(configDir, 'dist', 'index.js'), "console.log('ran cwd dist');\n");

    const result = run(launcher, [], { configDir, cwd: configDir });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
  });
});

test('install replaces another status line only with --replace, and keeps other settings', async () => {
  await withConfigDir(async (configDir) => {
    const settingsPath = path.join(configDir, 'settings.json');
    const before = JSON.stringify({
      model: 'opus',
      statusLine: { type: 'command', command: 'bash ~/statusline.sh --token=secret123' },
    });
    await writeFile(settingsPath, before);

    const refused = install(['--shell', 'posix'], { configDir });
    assert.equal(refused.status, 1);
    assert.match(refused.stdout, /statusLine already runs another command/);
    assert.doesNotMatch(refused.stdout, /secret123/);
    assert.equal(await readFile(settingsPath, 'utf8'), before);

    const result = install(['--shell', 'posix', '--replace'], { configDir });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
    const installedLauncher = path.join(configDir, 'plugins', 'claude-hud', 'statusline.mjs');

    assert.equal(settings.model, 'opus');
    assert.deepEqual(settings.statusLine, {
      type: 'command',
      command: `'${process.execPath}' '${installedLauncher}'`,
    });
    assert.equal(await readFile(installedLauncher, 'utf8'), await readFile(launcher, 'utf8'));
    assert.match(await readFile(report.backupPath, 'utf8'), /secret123/);
    assert.equal(await readFile(report.previousCommandPath, 'utf8'), 'bash ~/statusline.sh --token=secret123');
    if (process.platform !== 'win32') {
      assert.equal((await stat(report.previousCommandPath)).mode & 0o777, 0o600);
    }
  });
});

test('reinstall keeps the existing claude-hud statusLine keys', async () => {
  await withConfigDir(async (configDir) => {
    const settingsPath = path.join(configDir, 'settings.json');
    await writeFile(settingsPath, JSON.stringify({
      statusLine: { type: 'command', command: 'old claude-hud command', refreshInterval: 10 },
    }));

    const result = install(['--shell', 'posix'], { configDir });
    assert.equal(result.status, 0, result.stderr);
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
    assert.equal(settings.statusLine.refreshInterval, 10);
    assert.notEqual(settings.statusLine.command, 'old claude-hud command');
  });
});

test('install writes through a settings.json symlink and keeps its mode', { skip: process.platform === 'win32' }, async () => {
  await withConfigDir(async (configDir) => {
    const realSettings = path.join(configDir, 'dotfiles-settings.json');
    const settingsPath = path.join(configDir, 'settings.json');
    await writeFile(realSettings, JSON.stringify({ env: { API_KEY: 'secret' } }), { mode: 0o600 });
    await symlink(realSettings, settingsPath);

    const result = install(['--shell', 'posix'], { configDir });
    assert.equal(result.status, 0, result.stderr);
    assert.ok((await lstat(settingsPath)).isSymbolicLink());
    assert.equal((await stat(realSettings)).mode & 0o777, 0o600);
    const settings = JSON.parse(await readFile(realSettings, 'utf8'));
    assert.equal(settings.env.API_KEY, 'secret');
    assert.equal(settings.statusLine.type, 'command');
  });
});

test('install refuses to overwrite invalid settings.json', async () => {
  await withConfigDir(async (configDir) => {
    const settingsPath = path.join(configDir, 'settings.json');
    await writeFile(settingsPath, '{ not json');

    const result = install(['--shell', 'posix'], { configDir });
    assert.equal(result.status, 1);
    assert.equal(await readFile(settingsPath, 'utf8'), '{ not json');
  });
});

test('Windows shells launch through cmd.exe', async () => {
  await withConfigDir(async (configDir) => {
    const gitBash = install(['--shell', 'gitbash'], { configDir });
    assert.equal(gitBash.status, 0, gitBash.stderr);
    assert.equal(
      JSON.parse(gitBash.stdout).command,
      'exec "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/claude-hud/statusline.cmd"',
    );
    assert.equal(
      await readFile(path.join(configDir, 'plugins', 'claude-hud', 'statusline.cmd'), 'utf8'),
      `@echo off\r\n"${process.execPath}" "%~dp0statusline.mjs"\r\n`,
    );

    const powershell = JSON.parse(install(['--shell', 'powershell'], { configDir }).stdout);
    assert.match(powershell.command, /System32\\cmd\.exe \/d \/s \/c ""/);
  });
});

test('install picks the shell Claude Code runs statusLine with', async () => {
  const { detectShell } = await import('../install.mjs');
  assert.equal(detectShell({}, 'linux'), 'posix');
  assert.equal(detectShell({}, 'darwin'), 'posix');
  assert.equal(detectShell({ MSYSTEM: 'MINGW64' }, 'win32'), 'gitbash');
  assert.equal(detectShell({ SHELL: '/usr/bin/bash' }, 'win32'), 'gitbash');
  assert.equal(detectShell({}, 'win32'), 'powershell');
});
