// End-to-end golden output: runs dist/index.js for every case in
// tests/golden/cases.mjs and compares stdout with tests/golden/expected.txt.
// Regenerate with `npm run test:update-snapshots`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, copyFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import cases, { NOW_MS } from './golden/cases.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const goldenDir = path.join(root, 'tests', 'golden');
const expectedPath = path.join(goldenDir, 'expected.txt');
const freezeTime = pathToFileURL(path.join(goldenDir, 'freeze-time.mjs')).href;
const update = process.env.UPDATE_SNAPSHOTS === '1';

async function setUpGit(cwd, env, state) {
  const git = (...args) => execFileSync(
    'git',
    ['-c', 'user.name=Golden', '-c', 'user.email=golden@example.com', ...args],
    { cwd, env, stdio: 'ignore' },
  );
  git('init', '-q', '-b', 'main');
  git('commit', '-q', '--allow-empty', '-m', 'init');
  if (state === 'ahead') {
    const remote = path.join(path.dirname(cwd), 'remote.git');
    execFileSync('git', ['init', '-q', '--bare', remote], { env, stdio: 'ignore' });
    git('remote', 'add', 'origin', remote);
    git('push', '-q', '-u', 'origin', 'main');
    git('commit', '-q', '--allow-empty', '-m', 'two');
    git('commit', '-q', '--allow-empty', '-m', 'three');
    return;
  }
  if (state !== 'dirty') return;
  await writeFile(path.join(cwd, 'tracked.txt'), 'one\n');
  git('add', 'tracked.txt');
  git('commit', '-q', '-m', 'add file');
  await writeFile(path.join(cwd, 'tracked.txt'), 'one\ntwo\nthree\n');
  await writeFile(path.join(cwd, 'untracked.txt'), 'new\n');
}

async function runCase(spec) {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), 'hud-golden-')));
  try {
    const home = path.join(base, 'home');
    const configDir = path.join(home, '.claude');
    const project = path.join(home, 'dev', spec.projectName ?? 'my-project');
    const transcript = path.join(configDir, 'projects', 'golden', 'transcript.jsonl');
    await mkdir(project, { recursive: true });
    await mkdir(path.dirname(transcript), { recursive: true });
    await copyFile(path.join(goldenDir, spec.transcript ?? 'transcript.jsonl'), transcript);
    if (spec.config) {
      const pluginDir = path.join(configDir, 'plugins', 'claude-hud');
      await mkdir(pluginDir, { recursive: true });
      await writeFile(path.join(pluginDir, 'config.json'), JSON.stringify(spec.config));
    }

    const env = {
      PATH: process.env.PATH,
      HOME: home,
      CLAUDE_CONFIG_DIR: configDir,
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      TZ: 'UTC',
      HUD_FAKE_NOW: String(NOW_MS),
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      ...(spec.columns ? { COLUMNS: String(spec.columns) } : {}),
    };
    if (spec.git) await setUpGit(project, env, spec.git);

    const input = JSON.stringify(spec.stdin)
      .replaceAll('<PROJECT>', project)
      .replaceAll('<TRANSCRIPT>', transcript);

    const stdout = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', freezeTime, path.join(root, 'dist', 'index.js')], {
        cwd: project,
        env,
      });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`exit ${code}: ${err}`))));
      child.stdin.end(input);
    });

    return stdout
      .replaceAll(pathToFileURL(base).href, 'file://<BASE>')
      .replaceAll(base, '<BASE>')
      .replaceAll('\x1b', '\\e')
      .replaceAll(' ', '<NBSP>')
      .trimEnd();
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

async function runAll(limit = 8) {
  const results = new Array(cases.length);
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < cases.length) {
      const i = next++;
      results[i] = await runCase(cases[i]);
    }
  }));
  return results;
}

function parseExpected(text) {
  const map = new Map();
  for (const block of text.split(/^### /m).slice(1)) {
    const newline = block.indexOf('\n');
    map.set(block.slice(0, newline), block.slice(newline + 1).replace(/\n+$/, ''));
  }
  return map;
}

test('golden output', { skip: process.platform === 'win32' }, async (t) => {
  const outputs = await runAll();
  const actual = cases.map((c, i) => `### ${c.name}\n${outputs[i]}\n`).join('\n');
  if (update) {
    await writeFile(expectedPath, actual);
    return;
  }

  const expected = parseExpected(await readFile(expectedPath, 'utf8').catch(() => ''));
  assert.deepEqual([...expected.keys()], cases.map((c) => c.name), 'case list changed; run npm run test:update-snapshots');
  for (const [i, c] of cases.entries()) {
    await t.test(c.name, () => assert.equal(outputs[i], expected.get(c.name)));
  }
});
