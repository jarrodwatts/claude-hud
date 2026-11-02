// Users already have scripts/statusline.mjs copied into their config dir, and it imports
// dist/index.js (src/index.ts under Bun) from the newest installed version. Those files are now
// stubs that forward to hud.mjs. This runs that launcher against a fake install of this tree.
// It imports no .ts, so CI also runs it alone on Node 20, where it checks the upgrade line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isNodeSupported } from '../hud.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const INSTALLED = ['hud.mjs', 'collector.mjs', 'fence.mjs', 'package.json', 'dist', 'src'];
const STDIN = JSON.stringify({ model: { display_name: 'Opus' }, context_window: { used_percentage: 45, context_window_size: 200_000 } });

function render(runtime, args) {
  const home = mkdtempSync(path.join(tmpdir(), 'hud-launcher-'));
  try {
    const configDir = path.join(home, '.claude');
    const version = path.join(configDir, 'plugins', 'cache', 'claude-hud', 'claude-hud', '0.14.2');
    for (const name of INSTALLED) cpSync(path.join(root, name), path.join(version, name), { recursive: true });
    const launcher = path.join(configDir, 'plugins', 'claude-hud', 'statusline.mjs');
    cpSync(path.join(root, 'scripts', 'statusline.mjs'), launcher);
    return spawnSync(runtime, [...args, launcher], {
      input: STDIN,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, SystemRoot: process.env.SystemRoot, CLAUDE_CONFIG_DIR: configDir, COLUMNS: '104' },
    });
  } finally {
    rmSync(home, { recursive: true, force: true, maxRetries: 5 });
  }
}

test('the launcher on users\' machines renders this tree through dist/index.js', () => {
  const result = render(process.execPath, []);
  assert.equal(result.status, 0, result.stderr);
  if (isNodeSupported()) {
    assert.match(result.stdout, /\[Opus\]/);
    assert.match(result.stdout, /45%/);
    assert.equal(result.stdout.split('\n').length, 3, result.stdout);
  } else {
    assert.equal(result.stdout, `claude-hud needs Node 22.18+ (this is ${process.version}). Type /hud to fix it.\n`);
  }
});

const bun = spawnSync('bun', ['--version'], { encoding: 'utf8' });
test('under Bun the same launcher goes through src/index.ts and renders on Node', {
  skip: bun.status === 0 ? false : 'bun not installed',
}, () => {
  // setup.mjs installs Bun launches with --env-file /dev/null.
  const result = render('bun', process.platform === 'win32' ? [] : ['--env-file', '/dev/null']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[Opus\]/);
  assert.match(result.stdout, /45%/);
});
