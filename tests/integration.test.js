import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';

function stripAnsi(text) {
  return text.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nq-uy=><]/g,
    ''
  );
}

test('CLI renders expected output for a basic transcript', async () => {
  const fixturePath = fileURLToPath(new URL('./fixtures/transcript-render.jsonl', import.meta.url));
  const expectedPath = fileURLToPath(new URL('./fixtures/expected/render-basic.txt', import.meta.url));
  const expected = readFileSync(expectedPath, 'utf8').trimEnd();

  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-home-'));
  // Use a fixed project name for deterministic test output
  const projectDir = path.join(homeDir, 'my-project');
  await import('node:fs/promises').then(fs => fs.mkdir(projectDir));
  try {
    const stdin = JSON.stringify({
      model: { display_name: 'Opus' },
      context_window: {
        context_window_size: 200000,
        current_usage: { input_tokens: 45000 },
      },
      transcript_path: fixturePath,
      cwd: projectDir,
    });

    const result = spawnSync('node', ['dist/index.js'], {
      cwd: path.resolve(process.cwd()),
      input: stdin,
      encoding: 'utf8',
      env: { ...process.env, HOME: homeDir },
    });

    assert.equal(result.status, 0, result.stderr || 'non-zero exit');
    const normalized = stripAnsi(result.stdout).replace(/\u00A0/g, ' ').trimEnd();
    if (process.env.UPDATE_SNAPSHOTS === '1') {
      await writeFile(expectedPath, normalized + '\n', 'utf8');
      return;
    }
    assert.equal(normalized, expected);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('CLI prints initializing message on empty stdin', () => {
  const result = spawnSync('node', ['dist/index.js'], {
    cwd: path.resolve(process.cwd()),
    input: '',
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || 'non-zero exit');
  const normalized = stripAnsi(result.stdout).replace(/\u00A0/g, ' ').trimEnd();
  assert.equal(normalized, '[claude-hud] Initializing...');
});
