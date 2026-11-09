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

// Characters that cmd.exe or PowerShell would read in a path: non-ASCII (a batch file is read in the
// console code page), a space, and each shell's own specials.
const ODD_RUNTIME = "C:\\Users\\张三\\O'Brien ’ 100% & (x) $HOME;!\\node.exe";
const ODD_DIR = "用户 O'Brien ’ 100% & (x) $HOME;!";

test('Git Bash: the shim holds no path, and cmd.exe gets the runtime and the shim through the environment', async () => {
  const { install: installTo } = await import('../install.mjs');
  await withConfigDir(async (root) => {
    const configDir = path.join(root, ODD_DIR, '.claude');
    const { command } = installTo({ configDir, argv: ['--shell', 'gitbash'], env: { SystemRoot: 'C:\\WINDOWS' }, runtime: ODD_RUNTIME });
    assert.equal(
      await readFile(path.join(configDir, 'plugins', 'claude-hud', 'statusline-env.cmd'), 'utf8'),
      '@echo off\r\n"%CLAUDE_HUD_RUNTIME%" "%~dp0statusline.mjs"\r\n',
    );

    const cmdExe = "'C:\\WINDOWS\\System32\\cmd.exe'";
    assert.ok(command.includes(` exec ${cmdExe} `), command);

    if (process.platform === 'win32') return;
    // A stand-in takes cmd.exe's place and records what bash hands it, and whether msys path conversion is off for it.
    const standIn = path.join(root, 'cmd.exe');
    await writeFile(standIn, '#!/bin/sh\nprintf \'%s\\0\' "$@" "$CLAUDE_HUD_RUNTIME" "$CLAUDE_HUD_SHIM" "$CLAUDE_HUD_QUOTE" "$MSYS_NO_PATHCONV" "$MSYS2_ARG_CONV_EXCL"\n', { mode: 0o755 });
    const ran = spawnSync('bash', ['-c', command.replace(cmdExe, `'${standIn}'`)], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
    assert.equal(ran.status, 0, ran.stderr);
    assert.deepEqual(ran.stdout.split('\0').slice(0, -1), [
      '/d', '/v:off', '/c', '%CLAUDE_HUD_QUOTE%%CLAUDE_HUD_SHIM%%CLAUDE_HUD_QUOTE%',
      ODD_RUNTIME, path.join(configDir, 'plugins', 'claude-hud', 'statusline-env.cmd'), '"', '1', '*',
    ]);
  });
});

test('Git Bash: the statusline.cmd an older command runs stays as it was', async () => {
  const { install: installTo } = await import('../install.mjs');
  await withConfigDir(async (configDir) => {
    // Older commands run statusline.cmd, which holds the runtime itself. If the settings write fails, or a
    // copy of the old command lives in another settings file, that command must still find its shim.
    const old = path.join(configDir, 'plugins', 'claude-hud', 'statusline.cmd');
    await mkdir(path.dirname(old), { recursive: true });
    await writeFile(old, '@echo off\r\n"C:\\node\\node.exe" "%~dp0statusline.mjs"\r\n');
    installTo({ configDir, argv: ['--shell', 'gitbash'], env: { SystemRoot: 'C:\\WINDOWS' }, runtime: ODD_RUNTIME });
    assert.equal(await readFile(old, 'utf8'), '@echo off\r\n"C:\\node\\node.exe" "%~dp0statusline.mjs"\r\n');
  });
});

test('Git Bash: cmd.exe comes only from a drive-absolute SystemRoot', async () => {
  const { install: installTo } = await import('../install.mjs');
  await withConfigDir(async (configDir) => {
    const gitBash = (env) => installTo({ configDir, argv: ['--shell', 'gitbash'], env, runtime: ODD_RUNTIME });
    for (const SystemRoot of ['.\\repo', 'repo', 'C:', 'C:repo', '\\Windows', '\\\\server\\share', 'C:\\Win\0dows']) {
      assert.throws(() => gitBash({ SystemRoot }), /SystemRoot/, SystemRoot);
    }
    assert.equal(await readFile(path.join(configDir, 'settings.json'), 'utf8').catch(() => 'absent'), 'absent');
    assert.match(gitBash({ SYSTEMROOT: 'D:\\Win' }).command, / exec 'D:\\Win\\System32\\cmd\.exe' /);
    assert.match(gitBash({}).command, / exec 'C:\\Windows\\System32\\cmd\.exe' /);
  });
});

test('PowerShell: the command calls the runtime with each path as a literal string', async () => {
  const { install: installTo } = await import('../install.mjs');
  await withConfigDir(async (root) => {
    const configDir = path.join(root, ODD_DIR, '.claude');
    const { command } = installTo({ configDir, argv: ['--shell', 'powershell'], env: {}, runtime: ODD_RUNTIME });
    // PowerShell ends a single-quoted string at ' or at any of the four typographic single quotes, and reads
    // each doubled one as itself.
    const launcher = path.join(configDir, 'plugins', 'claude-hud', 'statusline.mjs').replace(/['‘’‚‛]/g, '$&$&');
    assert.equal(command, `& 'C:\\Users\\张三\\O''Brien ’’ 100% & (x) $HOME;!\\node.exe' '${launcher}'`);
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
