import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isHudDisabled } from '../dist/index.js';
import { formatSessionDuration } from '../dist/utils/format.js';

const entry = fileURLToPath(new URL('../dist/index.js', import.meta.url));

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

test('formatSessionDuration formats Claude Code session time', () => {
  assert.equal(formatSessionDuration(undefined), '');
  assert.equal(formatSessionDuration(-1), '');
  assert.equal(formatSessionDuration(30_000), '<1m');
  assert.equal(formatSessionDuration(5 * 60_000), '5m');
  assert.equal(formatSessionDuration(125 * 60_000), '2h 5m');
});
