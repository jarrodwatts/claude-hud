import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isHudDisabled } from '../hud.mjs';
import { formatSessionDuration } from '../src/utils/format.ts';

const entry = fileURLToPath(new URL('../hud.mjs', import.meta.url));

async function runCli(input, env = {}) {
  const home = await mkdtemp(path.join(tmpdir(), 'hud-index-'));
  try {
    return spawnSync(process.execPath, [entry], {
      input,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: path.join(home, '.claude'), ...env },
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test('isHudDisabled treats any value but an explicit negative as disabled', () => {
  for (const value of ['1', 'true', 'TRUE', 'yes', 'on', ' 1 ']) {
    assert.equal(isHudDisabled({ CLAUDE_HUD_DISABLE: value }), true, value);
  }
  for (const value of [undefined, '', ' ', '0', 'false', 'OFF', 'no']) {
    assert.equal(isHudDisabled({ CLAUDE_HUD_DISABLE: value }), false, String(value));
  }
});

test('the CLI renders stdin, stays silent when disabled, and reports bad input', async () => {
  const stdin = JSON.stringify({ model: { display_name: 'Opus' }, context_window: { used_percentage: 12, context_window_size: 200_000 } });

  const rendered = await runCli(stdin);
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(rendered.stdout, /\[Opus\]/);
  assert.match(rendered.stdout, /12%/);

  const disabled = await runCli(stdin, { CLAUDE_HUD_DISABLE: '1' });
  assert.equal(disabled.stdout, '');

  // No input is how setup checks that the command starts.
  const empty = await runCli('');
  assert.match(empty.stdout, /\[claude-hud\] Initializing/);
});

// #857: a rule linked from outside the read grants can't be stat'ed in the cage.
test('a rule linked from outside the grants skips only itself', {
  skip: process.platform === 'win32' ? 'symlinks need privileges on Windows' : false,
}, async () => {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), 'hud-rules-')));
  try {
    const cfg = path.join(base, 'cfg');
    await mkdir(path.join(cfg, 'plugins', 'claude-hud'), { recursive: true });
    await mkdir(path.join(cfg, 'rules'));
    await mkdir(path.join(base, 'elsewhere'));
    await mkdir(path.join(base, 'proj'));
    await writeFile(path.join(cfg, 'plugins', 'claude-hud', 'config.json'), '{"display":{"showConfigCounts":true}}');
    await writeFile(path.join(base, 'elsewhere', 'a.md'), 'pack\n');
    // Named to sort first, so a denied link used to end the count before the plain files.
    await symlink(path.join(base, 'elsewhere', 'a.md'), path.join(cfg, 'rules', 'a.md'));
    for (const name of ['b', 'c', 'd']) await writeFile(path.join(cfg, 'rules', `${name}.md`), `${name}\n`);

    const result = spawnSync(process.execPath, [entry], {
      input: JSON.stringify({ cwd: path.join(base, 'proj'), model: { display_name: 'Opus' } }),
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: base, CLAUDE_CONFIG_DIR: cfg, COLUMNS: '120' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout.replace(/\x1b\[[0-9;]*m/g, ''), /\b3 rules\b/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('formatSessionDuration formats Claude Code session time', () => {
  assert.equal(formatSessionDuration(undefined), '');
  assert.equal(formatSessionDuration(-1), '');
  assert.equal(formatSessionDuration(30_000), '<1m');
  assert.equal(formatSessionDuration(5 * 60_000), '5m');
  assert.equal(formatSessionDuration(125 * 60_000), '2h 5m');
});
