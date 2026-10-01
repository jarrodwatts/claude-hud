import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getGitStatus, parseNumstat, parseStatus } from '../dist/git.js';

const IDENTITY = ['-c', 'user.name=Test', '-c', 'user.email=test@test.com', '-c', 'commit.gpgsign=false'];

async function withRepo(fn, { commit = true } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-git-'));
  const git = (...args) => execFileSync('git', [...IDENTITY, ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const write = (name, content) => writeFile(path.join(dir, name), content);
  try {
    git('init', '-q', '-b', 'main');
    if (commit) git('commit', '-q', '--allow-empty', '-m', 'init');
    await fn({ dir, git, write });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function mergeConflict(git) {
  try {
    git('merge', 'side');
  } catch {
    return;
  }
  assert.fail('expected the merge to conflict');
}

test('getGitStatus returns null without a cwd or outside a repo', async () => {
  assert.equal(await getGitStatus(undefined), null);
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-nogit-'));
  try {
    assert.equal(await getGitStatus(dir), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getGitStatus reports a clean branch', async () => {
  await withRepo(async ({ dir }) => {
    assert.deepEqual(await getGitStatus(dir), { branch: 'main', isDirty: false, ahead: 0, behind: 0, branchUrl: undefined });
  });
});

test('getGitStatus shows the branch of a repo with no commits yet', async () => {
  await withRepo(async ({ dir, write }) => {
    await write('new.txt', 'x\n');
    const status = await getGitStatus(dir);
    assert.equal(status?.branch, 'main');
    assert.equal(status?.fileStats?.untracked, 1);
  }, { commit: false });
});

test('getGitStatus counts modified, added, deleted, renamed, and untracked files', async () => {
  await withRepo(async ({ dir, git, write }) => {
    await write('keep.txt', 'a\n');
    await write('gone.txt', 'a\n');
    await write('old name.txt', 'a\nb\n');
    git('add', '.');
    git('commit', '-q', '-m', 'files');

    await write('keep.txt', 'a\nchanged\n');
    await rm(path.join(dir, 'gone.txt'));
    git('mv', 'old name.txt', 'new name.txt');
    await write('staged.txt', 'new\n');
    git('add', 'staged.txt');
    await write('untracked.txt', 'new\n');

    const status = await getGitStatus(dir);
    assert.equal(status?.isDirty, true);
    const { trackedFiles, ...counts } = status.fileStats;
    assert.deepEqual(counts, { modified: 2, added: 1, deleted: 1, untracked: 1 });
    assert.deepEqual(
      trackedFiles.map((file) => `${file.type}:${file.fullPath}`).sort(),
      ['added:staged.txt', 'deleted:gone.txt', 'modified:keep.txt', 'modified:new name.txt'],
    );
    assert.equal(status.lineDiff, undefined, 'line diffs only run when requested');
  });
});

test('getGitStatus attaches line diffs, including to renamed and unusually named files', async () => {
  await withRepo(async ({ dir, git, write }) => {
    const odd = process.platform === 'win32' ? 'tab and ünïcode.txt' : 'tab\tand\x1bünïcode.txt';
    await write('old.txt', 'a\nb\n');
    await write(odd, 'a\n');
    git('add', '.');
    git('commit', '-q', '-m', 'files');

    git('mv', 'old.txt', 'renamed.txt');
    await write('renamed.txt', 'a\nb\nc\n');
    await write(odd, 'a\nb\nc\nd\n');

    const status = await getGitStatus(dir, { lineDiffs: true });
    assert.deepEqual(status?.lineDiff, { added: 4, deleted: 0 });
    const byPath = Object.fromEntries(status.fileStats.trackedFiles.map((file) => [file.fullPath, file.lineDiff]));
    assert.deepEqual(byPath, { 'renamed.txt': { added: 1, deleted: 0 }, [odd]: { added: 3, deleted: 0 } });
  });
});

test('getGitStatus counts unmerged paths once each', async () => {
  await withRepo(async ({ dir, git, write }) => {
    await write('conflict.txt', 'base\n');
    await write('original.txt', 'base\n');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    git('checkout', '-q', '-b', 'side');
    await write('conflict.txt', 'side\n');
    git('mv', 'original.txt', 'side.txt');
    git('commit', '-q', '-am', 'side');
    git('checkout', '-q', 'main');
    await write('conflict.txt', 'ours\n');
    git('mv', 'original.txt', 'ours.txt');
    git('commit', '-q', '-am', 'ours');
    mergeConflict(git);

    const reported = git('status', '--porcelain').split('\n').filter(Boolean).length;
    const stats = (await getGitStatus(dir))?.fileStats;
    assert.equal(stats.modified + stats.added + stats.deleted + stats.untracked, reported);
    assert.equal(stats.trackedFiles.find((file) => file.fullPath === 'conflict.txt')?.type, 'modified');
  });
});

test('getGitStatus names a detached HEAD by tag, else by short sha', async () => {
  await withRepo(async ({ dir, git }) => {
    git('tag', 'v1.0.0');
    git('checkout', '-q', '--detach');
    assert.equal((await getGitStatus(dir))?.branch, 'v1.0.0');

    git('commit', '-q', '--allow-empty', '-m', 'untagged');
    const sha = git('rev-parse', 'HEAD').trim();
    assert.equal((await getGitStatus(dir))?.branch, `detached:${sha.slice(0, 7)}`);
  });
});

test('getGitStatus counts commits ahead of and behind the upstream', async () => {
  await withRepo(async ({ dir, git }) => {
    git('branch', 'upstream');
    git('branch', '-q', '--set-upstream-to=upstream');
    git('commit', '-q', '--allow-empty', '-m', 'ours 1');
    git('commit', '-q', '--allow-empty', '-m', 'ours 2');
    git('checkout', '-q', 'upstream');
    git('commit', '-q', '--allow-empty', '-m', 'theirs');
    git('checkout', '-q', 'main');

    const status = await getGitStatus(dir);
    assert.equal(status?.ahead, 2);
    assert.equal(status?.behind, 1);
  });
});

test('getGitStatus links GitHub branches and commits from the stdin repo identity', async () => {
  await withRepo(async ({ dir, git }) => {
    const repo = { host: 'github.com', owner: 'octo', name: 'hud' };
    git('checkout', '-q', '-b', 'feat/x#1');
    assert.equal((await getGitStatus(dir, { repo }))?.branchUrl, 'https://github.com/octo/hud/tree/feat/x%231');

    git('checkout', '-q', '--detach');
    const sha = git('rev-parse', 'HEAD').trim().slice(0, 7);
    assert.equal((await getGitStatus(dir, { repo }))?.branchUrl, `https://github.com/octo/hud/commit/${sha}`);

    for (const other of [{ ...repo, host: 'gitlab.com' }, { ...repo, owner: 'a/b' }, { ...repo, name: 'x?y' }, null]) {
      assert.equal((await getGitStatus(dir, { repo: other }))?.branchUrl, undefined);
    }
  });
});

test('getGitStatus falls back to the branch alone when status times out', {
  skip: process.platform === 'win32' ? 'needs a POSIX fsmonitor hook' : false,
}, async () => {
  await withRepo(async ({ dir, git, write }) => {
    const hook = path.join(dir, '.git', 'slow-fsmonitor');
    await write('.git/slow-fsmonitor', '#!/bin/sh\nsleep 3\n');
    await chmod(hook, 0o755);
    git('config', 'core.fsmonitor', hook);

    const started = Date.now();
    assert.deepEqual(await getGitStatus(dir), { branch: 'main', isDirty: false, ahead: 0, behind: 0, branchUrl: undefined });
    assert.ok(Date.now() - started < 2500, 'gave up on the slow status');
  });
});

test('parseStatus reads porcelain v2 headers and every record type', () => {
  const output = [
    '# branch.oid 1234567890abcdef1234567890abcdef12345678',
    '# branch.head (detached)',
    '# branch.upstream origin/main',
    '# branch.ab +3 -1',
    '1 .M N... 100644 100644 100644 aaaa aaaa src/with space.ts',
    '2 R. N... 100644 100644 100644 aaaa aaaa R100 new name.ts',
    'old name.ts',
    'u UU N... 100644 100644 100644 100644 aaaa bbbb cccc both.ts',
    '1 .T N... 100644 120000 120000 aaaa aaaa typechange.ts',
    '? untracked.ts',
    '',
  ].join('\0');

  const parsed = parseStatus(output);
  assert.equal(parsed.oid, '1234567890abcdef1234567890abcdef12345678');
  assert.equal(parsed.head, null);
  assert.equal(parsed.ahead, 3);
  assert.equal(parsed.behind, 1);
  assert.equal(parsed.dirty, true);
  assert.deepEqual(parsed.fileStats.trackedFiles.map((file) => file.fullPath), ['src/with space.ts', 'new name.ts', 'both.ts']);
  assert.equal(parsed.fileStats.trackedFiles[0].basename, 'with space.ts');
  assert.equal(parsed.fileStats.modified, 3);
  assert.equal(parsed.fileStats.untracked, 1);
});

test('parseNumstat keys renames by their new path and skips binary files', () => {
  const output = ['3\t1\tsrc/a.ts', '2\t0\t', 'old.ts', 'new.ts', '-\t-\timage.png', '1\t1\ttab\tname.ts', ''].join('\0');
  assert.deepEqual([...parseNumstat(output)], [
    ['src/a.ts', { added: 3, deleted: 1 }],
    ['new.ts', { added: 2, deleted: 0 }],
    ['tab\tname.ts', { added: 1, deleted: 1 }],
  ]);
});
