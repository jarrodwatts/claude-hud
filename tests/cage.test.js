import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { claudePaths, logicPaths, prepareDataDir, readGrants, stripLogic, strippedName } from '../collector.mjs';

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

test('logic is stripped once into stripped/, named by source hash, and old versions are dropped', () => withHome((home, paths) => {
  const root = path.join(home, 'plugin');
  mkdirSync(path.join(root, 'src', 'render'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'a.ts'), 'export const a: number = 1;\n');
  writeFileSync(path.join(root, 'src', 'render', 'b.ts'), 'export const b = (x: string): string => x;\n');
  writeFileSync(path.join(root, 'src', 'notes.md'), 'not code');
  const dir = paths.strippedDir;
  const name = strippedName('export const a: number = 1;\n');
  assert.deepEqual(stripLogic(dir, root), { dir, files: { 'src/a.ts': name, 'src/render/b.ts': strippedName('export const b = (x: string): string => x;\n') } });
  const a = path.join(dir, name);
  assert.equal(readFileSync(a, 'utf8'), 'export const a         = 1;\n');
  assert.equal(readdirSync(dir).length, 2);
  assert.ok(!dir.startsWith(paths.dataDir), 'logic can write data/, so its code lives elsewhere');

  writeFileSync(path.join(root, 'src', 'a.ts'), 'export const a: number = 2;\n');
  stripLogic(dir, root);
  assert.ok(!existsSync(a), "the old version's file is gone");
  assert.equal(readdirSync(dir).length, 2);
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
  const named = logicPaths(paths, { cwd, transcript_path: path.join(home, '.claude', 'projects', 'p', 's.jsonl') });
  assert.equal(named.project.localSettings, path.join(cwd, '.claude', 'settings.local.json'));
  assert.equal(named.subagents, path.join(home, '.claude', 'projects', 'p', 's', 'subagents'));
  const grants = readGrants('/plugin', named);
  assert.ok(grants.includes(path.join(paths.configDir, 'settings.json')));
  assert.ok(grants.includes(named.project.localSettings));
  assert.ok(grants.includes(named.subagents));
  assert.ok(grants.includes(paths.claudeJson));
  for (const grant of grants) {
    assert.ok(!grant.endsWith('.credentials.json'), grant);
    assert.notEqual(grant, paths.configDir);
    assert.notEqual(grant, path.join(cwd, '.claude'));
  }
  const relative = logicPaths(paths, { cwd: 'relative', transcript_path: 'x.jsonl' });
  assert.equal(relative.project, null, 'relative paths are never granted');
  assert.equal(relative.transcript, null);
}));

test('a project whose .claude is the user config dir counts those files once, as the user\'s', () => withHome((home, paths) => {
  mkdirSync(paths.configDir, { recursive: true });
  const { project } = logicPaths(paths, { cwd: home });
  assert.deepEqual([project.dotClaudeMd, project.rules, project.settings], [null, null, null]);
  assert.equal(project.localSettings, path.join(paths.configDir, 'settings.local.json'));
}));

test('a symlinked rules directory is granted at its target too', {
  skip: process.platform === 'win32' ? 'symlinks need privileges on Windows' : false,
}, () => withHome((home, paths) => {
  const target = path.join(home, 'dotfiles', 'rules');
  mkdirSync(target, { recursive: true });
  mkdirSync(paths.configDir, { recursive: true });
  symlinkSync(target, path.join(paths.configDir, 'rules'));
  assert.ok(readGrants('/plugin', logicPaths(paths, null)).includes(target));
}));
