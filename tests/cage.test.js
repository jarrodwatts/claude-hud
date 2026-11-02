import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cageArgs, cageEnv, filterLine } from '../hud.mjs';
import { claudePaths, prepareDataDir, readGrants } from '../collector.mjs';

function withHome(fn) {
  const home = realpathSync(mkdtempSync(path.join(tmpdir(), 'hud-cage-')));
  try {
    return fn(home, claudePaths({}, home));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test('data/ is created private, and state from older releases moves into it', () => withHome((home, paths) => {
  mkdirSync(paths.hudDir, { recursive: true });
  writeFileSync(path.join(paths.hudDir, 'daily-cost.json'), '{"date":"20260101"}');
  mkdirSync(path.join(paths.hudDir, 'speed-cache'));
  writeFileSync(path.join(paths.hudDir, 'config.json'), '{}');

  const dataDir = prepareDataDir(paths);
  assert.equal(dataDir, path.join(paths.hudDir, 'data'));
  if (process.platform !== 'win32') assert.equal(lstatSync(dataDir).mode & 0o777, 0o700);
  assert.equal(readFileSync(path.join(dataDir, 'daily-cost.json'), 'utf8'), '{"date":"20260101"}');
  assert.ok(existsSync(path.join(dataDir, 'speed-cache')));
  assert.ok(!existsSync(path.join(paths.hudDir, 'daily-cost.json')));
  assert.ok(existsSync(path.join(paths.hudDir, 'config.json')), 'config.json stays where users edit it');
}));

test('symlinks in data/, and a symlinked data/ itself, are removed before logic runs', {
  skip: process.platform === 'win32' ? 'symlinks need privileges on Windows' : false,
}, () => withHome((home, paths) => {
  const outside = path.join(home, 'outside');
  mkdirSync(outside);
  mkdirSync(paths.hudDir, { recursive: true });
  symlinkSync(outside, paths.dataDir);
  assert.equal(prepareDataDir(paths), paths.dataDir, 'a symlinked data/ is replaced by a real directory');
  assert.ok(!lstatSync(paths.dataDir).isSymbolicLink());

  mkdirSync(path.join(paths.dataDir, 'transcript-cursors'));
  symlinkSync(path.join(outside, 'x'), path.join(paths.dataDir, 'transcript-cursors', 'planted.json'));
  symlinkSync(outside, path.join(paths.dataDir, 'cache'));
  prepareDataDir(paths);
  assert.ok(!existsSync(path.join(paths.dataDir, 'cache')));
  assert.throws(() => lstatSync(path.join(paths.dataDir, 'transcript-cursors', 'planted.json')), { code: 'ENOENT' });
  assert.ok(existsSync(outside), 'the target is untouched');
}));

test('logic may read its settings files but never .credentials.json or the whole config dir', () => withHome((home, paths) => {
  const cwd = path.join(home, 'project');
  const stdin = { cwd, transcript_path: path.join(home, '.claude', 'projects', 'p', 's.jsonl') };
  const grants = readGrants({ root: '/plugin', dataDir: paths.dataDir, paths, stdin });
  assert.ok(grants.includes(path.join(paths.configDir, 'settings.json')));
  assert.ok(grants.includes(path.join(cwd, '.claude', 'settings.local.json')));
  assert.ok(grants.includes(path.join(home, '.claude', 'projects', 'p', 's', 'subagents')));
  assert.ok(grants.includes(paths.claudeJson));
  for (const grant of grants) {
    assert.ok(!grant.endsWith('.credentials.json'), grant);
    assert.notEqual(grant, paths.configDir);
    assert.notEqual(grant, path.join(cwd, '.claude'), 'when cwd is home, that is the config dir');
  }
  assert.deepEqual(readGrants({ root: '/plugin', dataDir: '/d', paths, stdin: { cwd: 'relative', transcript_path: 'x.jsonl' } })
    .filter((g) => g.includes('relative') || g.includes('x.jsonl')), [], 'relative paths are never granted');
}));

test('a symlinked rules directory is granted at its target too', {
  skip: process.platform === 'win32' ? 'symlinks need privileges on Windows' : false,
}, () => withHome((home, paths) => {
  const target = path.join(home, 'dotfiles', 'rules');
  mkdirSync(target, { recursive: true });
  mkdirSync(paths.configDir, { recursive: true });
  symlinkSync(target, path.join(paths.configDir, 'rules'));
  assert.ok(readGrants({ root: '/plugin', dataDir: paths.dataDir, paths, stdin: null }).includes(target));
}));

test('logic gets no PATH and no secrets', () => {
  const env = cageEnv({
    PATH: '/usr/bin', HOME: '/home/u', TZ: 'UTC', CLAUDE_CONFIG_DIR: '/c', ANTHROPIC_API_KEY: 'sk-ant-fake',
    CLAUDE_CODE_OAUTH_TOKEN: 'fake', GITHUB_TOKEN: 'fake', AWS_SECRET_ACCESS_KEY: 'fake',
    ANTHROPIC_BASE_URL: 'https://user:pass@api.minimax.io/anthropic?key=fake',
  });
  assert.deepEqual(env, {
    PATH: '', HOME: '/home/u', TZ: 'UTC', CLAUDE_CONFIG_DIR: '/c', ANTHROPIC_API_KEY: 'set',
    ANTHROPIC_BASE_URL: 'https://api.minimax.io/anthropic',
  });
});

test('the cage never grants child processes, workers, addons, WASI or the network', () => {
  const args = cageArgs({ grants: ['/a', '/b'], dataDir: '/d' });
  assert.deepEqual(args.filter((a) => a.startsWith('--allow-')), ['--allow-fs-read=/a', '--allow-fs-read=/b', '--allow-fs-write=/d']);
  assert.ok(args.includes('--permission'));
  assert.ok(args.includes('--disallow-code-generation-from-strings'));
  assert.match(args.at(-2), /^--import=file:.*fence\.mjs$/);
  assert.ok(!cageArgs({ grants: [], dataDir: null }).some((a) => a.startsWith('--allow-fs-write')));
});

test('output keeps colour and file:/github.com links and drops every other control', () => {
  const link = (url, text) => `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
  for (const kept of ['\x1b[0m\x1b[36m[Opus]\x1b[0m', '\x1b[38;2;0;255;0mx\x1b[38;5;208my', link('file:///home/u/my%20project', 'p'),
    link('https://github.com/o/r/tree/main', 'main'), link('file://C:/Users/ü/項目', 'p'), 'a\u00a0b 全']) {
    assert.equal(filterLine(kept), kept);
  }
  // The link opener loses its ESC and shows as text; the empty closer is harmless and kept.
  assert.equal(filterLine(link('https://evil.example/', 'x')), ']8;;https://evil.example/\\x\x1b]8;;\x1b\\');
  assert.equal(filterLine('a\x1b]0;title\x07b'), 'a]0;titleb');
  assert.equal(filterLine('a\x1b[2Jb\x1b[1;1Hc'), 'a[2Jb[1;1Hc');
  assert.equal(filterLine('a\rb\tc\x9bd\x00e\x7f'), 'abcde');
});
