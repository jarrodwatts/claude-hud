import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstat, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const launcher = fileURLToPath(new URL('../scripts/statusline.mjs', import.meta.url));
const setupScript = fileURLToPath(new URL('../scripts/setup.mjs', import.meta.url));

async function withConfigDir(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'hud-setup-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const run = (file, args, { configDir, cwd, columns } = {}) => spawnSync(process.execPath, [file, ...args], {
  cwd,
  encoding: 'utf8',
  env: { ...process.env, CLAUDE_CONFIG_DIR: configDir, COLUMNS: columns ?? '' },
});

async function fakeInstall(configDir, version) {
  const dist = path.join(configDir, 'plugins', 'cache', 'market', 'claude-hud', version, 'dist');
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

test('launcher exits quietly with no install and never runs a cwd-relative dist', async () => {
  await withConfigDir(async (configDir) => {
    await mkdir(path.join(configDir, 'dist'), { recursive: true });
    await writeFile(path.join(configDir, 'dist', 'index.js'), "console.log('ran cwd dist');\n");

    const result = run(launcher, [], { configDir, cwd: configDir });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
  });
});

test('setup install writes the statusLine and keeps other settings', async () => {
  await withConfigDir(async (configDir) => {
    const settingsPath = path.join(configDir, 'settings.json');
    await writeFile(settingsPath, JSON.stringify({
      model: 'opus',
      statusLine: { type: 'command', command: 'bash ~/statusline.sh --token=secret123' },
    }));

    const inspected = JSON.parse(run(setupScript, ['inspect', '--shell', 'posix'], { configDir }).stdout);
    assert.equal(inspected.existing, 'other');
    assert.equal(inspected.existingPreview, 'bash ~/statusline.sh --token=[REDACTED]');

    const result = run(setupScript, ['install', '--shell', 'posix', '--refresh-interval', '5'], { configDir });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
    const installedLauncher = path.join(configDir, 'plugins', 'claude-hud', 'statusline.mjs');

    assert.equal(settings.model, 'opus');
    assert.deepEqual(settings.statusLine, {
      type: 'command',
      command: `'${process.execPath}' '${installedLauncher}'`,
      refreshInterval: 5,
    });
    assert.equal(await readFile(installedLauncher, 'utf8'), await readFile(launcher, 'utf8'));
    assert.match(await readFile(report.backupPath, 'utf8'), /secret123/);
    assert.equal(await readFile(report.previousCommandPath, 'utf8'), 'bash ~/statusline.sh --token=secret123');
    if (process.platform !== 'win32') {
      assert.equal((await stat(report.previousCommandPath)).mode & 0o777, 0o600);
    }
  });
});

test('setup install writes through a settings.json symlink and keeps its mode', { skip: process.platform === 'win32' }, async () => {
  await withConfigDir(async (configDir) => {
    const realSettings = path.join(configDir, 'dotfiles-settings.json');
    const settingsPath = path.join(configDir, 'settings.json');
    await writeFile(realSettings, JSON.stringify({ env: { API_KEY: 'secret' } }), { mode: 0o600 });
    await symlink(realSettings, settingsPath);

    const result = run(setupScript, ['install', '--shell', 'posix'], { configDir });
    assert.equal(result.status, 0, result.stderr);
    assert.ok((await lstat(settingsPath)).isSymbolicLink());
    assert.equal((await stat(realSettings)).mode & 0o777, 0o600);
    const settings = JSON.parse(await readFile(realSettings, 'utf8'));
    assert.equal(settings.env.API_KEY, 'secret');
    assert.equal(settings.statusLine.type, 'command');
  });
});

test('setup install refuses to overwrite invalid settings.json', async () => {
  await withConfigDir(async (configDir) => {
    const settingsPath = path.join(configDir, 'settings.json');
    await writeFile(settingsPath, '{ not json');

    const result = run(setupScript, ['install', '--shell', 'posix'], { configDir });
    assert.equal(result.status, 1);
    assert.equal(await readFile(settingsPath, 'utf8'), '{ not json');
  });
});

test('Windows shells launch through cmd.exe', async () => {
  await withConfigDir(async (configDir) => {
    const gitBash = run(setupScript, ['install', '--shell', 'gitbash'], { configDir });
    assert.equal(gitBash.status, 0, gitBash.stderr);
    assert.equal(
      JSON.parse(gitBash.stdout).command,
      'exec "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/claude-hud/statusline.cmd"',
    );
    assert.equal(
      await readFile(path.join(configDir, 'plugins', 'claude-hud', 'statusline.cmd'), 'utf8'),
      `@echo off\r\n"${process.execPath}" "%~dp0statusline.mjs"\r\n`,
    );

    const powershell = JSON.parse(run(setupScript, ['inspect', '--shell', 'powershell'], { configDir }).stdout);
    assert.match(powershell.command, /System32\\cmd\.exe \/d \/s \/c ""/);
  });
});
