import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getJjStatus, parseJjOutput } from '../src/jj.ts';
import { JJ_ARGS, createProbes, isJjRepo } from '../collector.mjs';

function hasJj() {
  try {
    execFileSync('jj', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const jjAvailable = hasJj();
const skipReason = jjAvailable ? false : 'jj binary not installed';

// Both halves: the jj run collector.mjs makes, and logic's parsing of its output.
const jjStatus = (cwd) => getJjStatus(createProbes({ cwd, argv: [] }));

test('isJjRepo returns false when cwd is undefined', () => {
  assert.equal(isJjRepo(undefined), false);
});

test('isJjRepo returns false for a non-jj directory', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-nojj-'));
  try {
    assert.equal(isJjRepo(dir), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getJjStatus returns null when cwd is undefined', async () => {
  assert.equal(await jjStatus(undefined), null);
});

test('getJjStatus returns null for a non-jj directory', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-nojj-'));
  try {
    assert.equal(await jjStatus(dir), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('jj runs a fixed read-only invocation', () => {
  assert.deepEqual(JJ_ARGS.slice(0, 4), ['--ignore-working-copy', '--at-operation=@', '--no-pager', 'log']);
  assert.deepEqual(JJ_ARGS.slice(4, 10), ['-r', '@', '--no-graph', '--color', 'never', '-T']);
  assert.match(JJ_ARGS[10] ?? '', /local_bookmarks/);
  assert.equal(JJ_ARGS.length, 11);
});

test('parseJjOutput strictly validates field count and boolean flags', () => {
  for (const stdout of [
    'change\x1fmain\x1f0',
    'change\x1fmain\x1f0\x1f0\x1fextra',
    'change\x1fmain\x1fyes\x1f0',
    'change\x1fmain\x1f0\x1f2',
    '\x1fmain\x1f0\x1f0',
    'change\x1fmain\x1f0\x1f0\nextra',
    'change\x1fmain\x1e\x1f0\x1f0',
  ]) {
    assert.equal(parseJjOutput(stdout), null, `expected malformed output to be rejected: ${JSON.stringify(stdout)}`);
  }
  assert.equal(parseJjOutput('qpvuntsm\x1fmain\x1f0\x1f0\n')?.branch, 'main');
});

test('parseJjOutput preserves commas and separates local bookmarks safely', () => {
  const result = parseJjOutput('qpvuntsm\x1ffeature,one\x1efeature-two\x1f1\x1f0');
  assert.equal(result?.branch, 'feature,one');
  assert.equal(result?.isDirty, true);
});

test('parseJjOutput sanitizes terminal controls and caps the chosen label', () => {
  const unsafe = `safe\x1b]8;;https://evil.example\x07link\x1b]8;;\x07‮${'x'.repeat(100)}`;
  const result = parseJjOutput(`qpvuntsm\x1f${unsafe}\x1f0\x1f1`);
  assert.ok(result);
  assert.equal(result.branch.length, 64);
  assert.equal(result.branch.includes('\x1b'), false);
  assert.equal(result.branch.includes('‮'), false);
  assert.equal(result.conflict, true);

  // A flag straddling the cap is dropped whole, not left as one regional indicator.
  assert.equal(parseJjOutput(`qpvuntsm\x1f${'x'.repeat(63)}🇬🇧\x1f0\x1f0`)?.branch, 'x'.repeat(63));
});

test('getJjStatus is null when the jj probe has no answer', async () => {
  assert.equal(await getJjStatus(async () => ({ jj: null })), null);
  assert.equal((await getJjStatus(async () => ({ jj: 'qpvuntsm\x1fmain\x1f0\x1f0\n' })))?.branch, 'main');
});

test('isJjRepo resolves the cwd before walking', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-jj-realpath-'));
  const link = `${dir}-link`;
  try {
    await mkdir(path.join(dir, '.jj'));
    await symlink(dir, link, 'dir');
    assert.equal(isJjRepo(link), true);
  } finally {
    await rm(link, { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
  }
});

test('isJjRepo rejects a symlinked .jj marker', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-jj-symlink-'));
  const markerTarget = await mkdtemp(path.join(tmpdir(), 'claude-hud-jj-marker-'));
  try {
    await symlink(markerTarget, path.join(dir, '.jj'), 'dir');
    assert.equal(isJjRepo(dir), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(markerTarget, { recursive: true, force: true });
  }
});

test('isJjRepo stops at a nearer .git marker', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-jj-boundary-'));
  const nested = path.join(dir, 'nested');
  const deep = path.join(nested, 'deep');
  try {
    await mkdir(path.join(dir, '.jj'));
    await mkdir(deep, { recursive: true });
    await writeFile(path.join(nested, '.git'), 'gitdir: elsewhere\n');
    assert.equal(isJjRepo(deep), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('isJjRepo prefers a same-directory .jj marker over .git', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-jj-colocated-'));
  try {
    await mkdir(path.join(dir, '.jj'));
    await mkdir(path.join(dir, '.git'));
    assert.equal(isJjRepo(dir), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('isJjRepo and getJjStatus detect a real jj repo', { skip: skipReason }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-jj-'));
  try {
    execFileSync('jj', ['git', 'init'], { cwd: dir, stdio: 'ignore' });

    assert.equal(isJjRepo(dir), true);

    const result = await jjStatus(dir);
    assert.equal(result?.vcs, 'jj');
    assert.equal(result?.conflict, false);
    assert.equal(result?.isDirty, false);
    assert.ok(result?.branch, `expected an anonymous change id, got ${JSON.stringify(result)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getJjStatus reports isDirty after an uncommitted change', { skip: skipReason }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-jj-'));
  try {
    execFileSync('jj', ['git', 'init'], { cwd: dir, stdio: 'ignore' });
    await writeFile(path.join(dir, 'a.txt'), 'hello');

    const result = await jjStatus(dir);
    assert.equal(result?.isDirty, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getJjStatus reports the bookmark name at @ when one exists', { skip: skipReason }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-jj-'));
  try {
    execFileSync('jj', ['git', 'init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('jj', ['bookmark', 'create', 'mybookmark', '-r', '@'], { cwd: dir, stdio: 'ignore' });

    const result = await jjStatus(dir);
    assert.equal(result?.branch, 'mybookmark');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('isJjRepo detects a jj repo from a nested subdirectory', { skip: skipReason }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-jj-'));
  try {
    execFileSync('jj', ['git', 'init'], { cwd: dir, stdio: 'ignore' });
    const nested = path.join(dir, 'a', 'b', 'c');
    await mkdir(nested, { recursive: true });

    assert.equal(isJjRepo(nested), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getJjStatus detects a genuine conflict', { skip: skipReason }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-jj-'));
  try {
    execFileSync('jj', ['git', 'init'], { cwd: dir, stdio: 'ignore' });
    await writeFile(path.join(dir, 'f.txt'), 'original\n');
    execFileSync('jj', ['commit', '-m', 'initial'], { cwd: dir, stdio: 'ignore' });

    const initialId = execFileSync(
      'jj',
      ['log', '-r', 'heads(::@- ~ root())', '--no-graph', '-T', 'change_id.shortest(8)'],
      { cwd: dir, encoding: 'utf8' }
    ).trim();

    execFileSync('jj', ['new', initialId, '-m', 'A'], { cwd: dir, stdio: 'ignore' });
    await writeFile(path.join(dir, 'f.txt'), 'A-version\n');
    const aId = execFileSync('jj', ['log', '-r', '@', '--no-graph', '-T', 'change_id.shortest(8)'], { cwd: dir, encoding: 'utf8' }).trim();

    execFileSync('jj', ['new', initialId, '-m', 'B'], { cwd: dir, stdio: 'ignore' });
    await writeFile(path.join(dir, 'f.txt'), 'B-version\n');
    const bId = execFileSync('jj', ['log', '-r', '@', '--no-graph', '-T', 'change_id.shortest(8)'], { cwd: dir, encoding: 'utf8' }).trim();

    execFileSync('jj', ['rebase', '-r', bId, '-d', aId], { cwd: dir, stdio: 'ignore' });
    execFileSync('jj', ['edit', bId], { cwd: dir, stdio: 'ignore' });

    const result = await jjStatus(dir);
    assert.equal(result?.conflict, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// Runs whether or not jj is installed: a stand-in jj on PATH answers with a recorded `jj log`, so
// this pins the collector's own call (it once called itself instead and always answered null).
test('the jj probe runs jj in the repo and answers with its output', {
  skip: process.platform === 'win32' ? 'the stand-in jj is a shell script' : false,
}, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-fakejj-'));
  const savedPath = process.env.PATH;
  try {
    const bin = path.join(dir, 'bin');
    const repo = path.join(dir, 'repo');
    await mkdir(bin);
    await mkdir(path.join(repo, '.jj'), { recursive: true });
    await writeFile(path.join(bin, 'jj'), "#!/bin/sh\nprintf 'kxqpwzmr\\037main\\0371\\0370\\n'\n", { mode: 0o755 });
    process.env.PATH = `${bin}${path.delimiter}${savedPath}`;
    const { jj } = await createProbes({ cwd: repo, argv: [] })(['jj']);
    assert.equal(jj, 'kxqpwzmr\x1fmain\x1f1\x1f0\n');
    assert.deepEqual(parseJjOutput(jj), { branch: 'main', isDirty: true, ahead: 0, behind: 0, vcs: 'jj', conflict: false });
  } finally {
    process.env.PATH = savedPath;
    await rm(dir, { recursive: true, force: true });
  }
});
