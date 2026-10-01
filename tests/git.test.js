import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getGitBranch, getGitStatus } from '../dist/git.js';

test('getGitBranch returns null when cwd is undefined', async () => {
  const result = await getGitBranch(undefined);
  assert.equal(result, null);
});

test('getGitBranch returns null for non-git directory', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-nogit-'));
  try {
    const result = await getGitBranch(dir);
    assert.equal(result, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getGitBranch returns branch name for git directory', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-git-'));
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });

    const result = await getGitBranch(dir);
    assert.ok(result === 'main' || result === 'master', `Expected main or master, got ${result}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getGitBranch returns custom branch name', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-git-'));
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['checkout', '-b', 'feature/test-branch'], { cwd: dir, stdio: 'ignore' });

    const result = await getGitBranch(dir);
    assert.equal(result, 'feature/test-branch');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getGitBranch returns an exact tag name for detached tagged HEAD', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-git-'));
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['-c', 'tag.gpgSign=false', 'tag', 'v1.2.3'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['checkout', '--detach', 'HEAD'], { cwd: dir, stdio: 'ignore' });

    const result = await getGitBranch(dir);
    assert.equal(result, 'v1.2.3');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getGitBranch returns a detached short sha label for untagged detached HEAD', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-git-'));
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
    const fullSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
    execFileSync('git', ['checkout', '--detach', fullSha], { cwd: dir, stdio: 'ignore' });

    const result = await getGitBranch(dir);
    assert.match(result ?? '', /^detached:[0-9a-f]{7,}$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// getGitStatus tests
test('getGitStatus returns null when cwd is undefined', async () => {
  const result = await getGitStatus(undefined);
  assert.equal(result, null);
});

test('getGitStatus returns null for non-git directory', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-nogit-'));
  try {
    const result = await getGitStatus(dir);
    assert.equal(result, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getGitStatus returns clean state for clean repo', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-git-'));
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });

    const result = await getGitStatus(dir);
    assert.ok(result?.branch === 'main' || result?.branch === 'master');
    assert.equal(result?.isDirty, false);
    assert.equal(result?.ahead, 0);
    assert.equal(result?.behind, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getGitStatus detects dirty state', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-git-'));
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });

    // Create uncommitted file
    await writeFile(path.join(dir, 'dirty.txt'), 'uncommitted change');

    const result = await getGitStatus(dir);
    assert.equal(result?.isDirty, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// fileStats tests
test('getGitStatus returns undefined fileStats for clean repo', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-git-'));
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });

    const result = await getGitStatus(dir);
    assert.equal(result?.fileStats, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getGitStatus counts untracked files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-git-'));
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });

    // Create untracked files
    await writeFile(path.join(dir, 'untracked1.txt'), 'content');
    await writeFile(path.join(dir, 'untracked2.txt'), 'content');

    const result = await getGitStatus(dir);
    assert.equal(result?.fileStats?.untracked, 2);
    assert.equal(result?.fileStats?.modified, 0);
    assert.equal(result?.fileStats?.added, 0);
    assert.equal(result?.fileStats?.deleted, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getGitStatus counts modified files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-git-'));
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });

    // Create and commit a file
    await writeFile(path.join(dir, 'file.txt'), 'original');
    execFileSync('git', ['add', 'file.txt'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'add file'], { cwd: dir, stdio: 'ignore' });

    // Modify the file
    await writeFile(path.join(dir, 'file.txt'), 'modified');

    const result = await getGitStatus(dir);
    assert.equal(result?.fileStats?.modified, 1);
    assert.equal(result?.fileStats?.untracked, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getGitStatus returns UTF-8 filenames when core.quotePath is true', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-git-'));
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'core.quotePath', 'true'], { cwd: dir, stdio: 'ignore' });

    const fileName = '日本語.txt';
    await writeFile(path.join(dir, fileName), 'original\n');
    execFileSync('git', ['add', fileName], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'add utf8 file'], { cwd: dir, stdio: 'ignore' });

    await writeFile(path.join(dir, fileName), 'modified\n');
    const quotedStatus = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });
    assert.match(quotedStatus, /\\[0-7]{3}/, `expected git to octal-escape path, got ${quotedStatus}`);
    assert.equal(quotedStatus.includes(fileName), false);

    const result = await getGitStatus(dir);
    const tracked = result?.fileStats?.trackedFiles ?? [];

    assert.equal(result?.fileStats?.modified, 1);
    assert.deepEqual(
      tracked.map((file) => ({ basename: file.basename, fullPath: file.fullPath, lineDiff: file.lineDiff })),
      [{ basename: fileName, fullPath: fileName, lineDiff: { added: 1, deleted: 1 } }]
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getGitStatus decodes C-quoted tracked paths', {
  skip: process.platform === 'win32' ? 'Windows filenames cannot contain control characters, " or \\' : false,
}, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-git-'));
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir, stdio: 'ignore' });

    const fileNames = [
      'esc\x1b-del\x7f-日本.txt',
      'bell\x07-vtab\x0b.txt',
      'quote".and-backslash\\.txt',
    ];
    for (const fileName of fileNames) {
      await writeFile(path.join(dir, fileName), 'one\n');
    }
    execFileSync('git', ['add', '--', ...fileNames], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'add quoted paths'], { cwd: dir, stdio: 'ignore' });
    for (const fileName of fileNames) {
      await writeFile(path.join(dir, fileName), 'one\ntwo\n');
    }

    const porcelain = execFileSync(
      'git', ['-c', 'core.quotePath=false', 'status', '--porcelain'],
      { cwd: dir, encoding: 'utf8' }
    );
    for (const escape of ['\\033', '\\177', '\\a', '\\v', '\\"', '\\\\']) {
      assert.ok(porcelain.includes(escape), `expected git to emit ${escape}, got ${JSON.stringify(porcelain)}`);
    }

    const result = await getGitStatus(dir);
    const tracked = result?.fileStats?.trackedFiles ?? [];
    assert.deepEqual(tracked.map((file) => file.fullPath).sort(), [...fileNames].sort());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getGitStatus counts staged added files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-git-'));
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });

    // Create and stage a new file
    await writeFile(path.join(dir, 'newfile.txt'), 'content');
    execFileSync('git', ['add', 'newfile.txt'], { cwd: dir, stdio: 'ignore' });

    const result = await getGitStatus(dir);
    assert.equal(result?.fileStats?.added, 1);
    assert.equal(result?.fileStats?.untracked, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getGitStatus counts deleted files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-git-'));
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });

    // Create, commit, then delete a file
    await writeFile(path.join(dir, 'todelete.txt'), 'content');
    execFileSync('git', ['add', 'todelete.txt'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'add file'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['rm', 'todelete.txt'], { cwd: dir, stdio: 'ignore' });

    const result = await getGitStatus(dir);
    assert.equal(result?.fileStats?.deleted, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getGitStatus counts a both-modified conflict as modified', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-git-'));
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });

    // Conflict the same file on two branches, leaving it unmerged as "UU".
    await writeFile(path.join(dir, 'conflict.txt'), 'base\n');
    execFileSync('git', ['add', 'conflict.txt'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'add file'], { cwd: dir, stdio: 'ignore' });

    execFileSync('git', ['checkout', '-b', 'side'], { cwd: dir, stdio: 'ignore' });
    await writeFile(path.join(dir, 'conflict.txt'), 'side\n');
    execFileSync('git', ['commit', '-am', 'side edit'], { cwd: dir, stdio: 'ignore' });

    execFileSync('git', ['checkout', '-'], { cwd: dir, stdio: 'ignore' });
    await writeFile(path.join(dir, 'conflict.txt'), 'ours\n');
    execFileSync('git', ['commit', '-am', 'our edit'], { cwd: dir, stdio: 'ignore' });

    try {
      execFileSync('git', ['merge', 'side'], { cwd: dir, stdio: 'ignore' });
      assert.fail('expected the merge to conflict');
    } catch (err) {
      if (err instanceof assert.AssertionError) throw err;
      // Expected: git exits non-zero and leaves the path unmerged.
    }

    const result = await getGitStatus(dir);
    assert.equal(result?.isDirty, true);
    assert.equal(result?.fileStats?.modified, 1);
    assert.equal(result?.fileStats?.trackedFiles[0]?.fullPath, 'conflict.txt');
    assert.equal(result?.fileStats?.trackedFiles[0]?.type, 'modified');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getGitStatus counts every unmerged path in a rename/rename conflict', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-git-'));
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });

    // Renaming one file to two different names on two branches produces a mix
    // of unmerged states (DD plus the added-by-us / added-by-them pair).
    await writeFile(path.join(dir, 'original.txt'), 'base\n');
    execFileSync('git', ['add', 'original.txt'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'add file'], { cwd: dir, stdio: 'ignore' });

    execFileSync('git', ['checkout', '-b', 'side'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['mv', 'original.txt', 'side.txt'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'side renames file'], { cwd: dir, stdio: 'ignore' });

    execFileSync('git', ['checkout', '-'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['mv', 'original.txt', 'ours.txt'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'we rename file'], { cwd: dir, stdio: 'ignore' });

    try {
      execFileSync('git', ['merge', 'side'], { cwd: dir, stdio: 'ignore' });
      assert.fail('expected the merge to conflict');
    } catch (err) {
      if (err instanceof assert.AssertionError) throw err;
      // Expected: git exits non-zero and leaves the paths unmerged.
    }

    // Compare against git's own report rather than a fixed set of status codes,
    // which vary with git's rename detection across versions.
    const porcelain = execFileSync(
      'git',
      ['-c', 'core.quotePath=false', 'status', '--porcelain'],
      { cwd: dir, encoding: 'utf8' },
    );
    const reportedPaths = porcelain.split('\n').filter(Boolean).length;

    const stats = (await getGitStatus(dir))?.fileStats;
    assert.ok(stats, 'expected fileStats for a conflicted repo');
    assert.ok(reportedPaths > 0, 'expected git to report unmerged paths');
    assert.equal(
      stats.modified + stats.added + stats.deleted + stats.untracked,
      reportedPaths,
      'every path git reports should be counted exactly once',
    );
    assert.equal(stats.trackedFiles.length + stats.untracked, reportedPaths);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getGitStatus includes total and per-file line diffs for modified files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-git-'));
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });

    await writeFile(path.join(dir, 'file.txt'), 'one\ntwo\nthree\n');
    execFileSync('git', ['add', 'file.txt'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'add file'], { cwd: dir, stdio: 'ignore' });

    await writeFile(path.join(dir, 'file.txt'), 'one\nthree\nfour\n');

    const result = await getGitStatus(dir);
    assert.deepEqual(result?.lineDiff, { added: 1, deleted: 1 });
    assert.deepEqual(result?.fileStats?.trackedFiles[0]?.lineDiff, { added: 1, deleted: 1 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getGitStatus attaches line diffs to renamed files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-git-'));
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir, stdio: 'ignore' });

    await writeFile(path.join(dir, 'old_name.txt'), 'one\ntwo\nthree\n');
    execFileSync('git', ['add', 'old_name.txt'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'add old_name'], { cwd: dir, stdio: 'ignore' });

    execFileSync('git', ['mv', 'old_name.txt', 'new_name.txt'], { cwd: dir, stdio: 'ignore' });
    await writeFile(path.join(dir, 'new_name.txt'), 'one\ntwo\nthree\nfour\nfive\n');
    execFileSync('git', ['add', 'new_name.txt'], { cwd: dir, stdio: 'ignore' });

    const result = await getGitStatus(dir);
    const tracked = result?.fileStats?.trackedFiles ?? [];
    const renamed = tracked.find((f) => f.fullPath?.endsWith('new_name.txt'));

    assert.ok(renamed, `expected renamed file in trackedFiles, got ${JSON.stringify(tracked)}`);
    assert.ok(
      renamed?.lineDiff,
      `expected lineDiff on renamed file, got ${JSON.stringify(renamed)}`
    );
    assert.equal(renamed?.lineDiff?.added, 2);
    assert.equal(renamed?.lineDiff?.deleted, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getGitStatus attaches line diffs to renamed files with shared directory prefix', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-git-'));
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir, stdio: 'ignore' });
    // Some git configurations emit numstat in the brace form: `pkg/{old.ts => new.ts}`.
    // Enable numstat-specific rename detection so we exercise that path.
    execFileSync('git', ['config', 'diff.renames', 'true'], { cwd: dir, stdio: 'ignore' });

    const pkgDir = path.join(dir, 'pkg');
    await writeFile(path.join(dir, '.gitkeep'), '');
    execFileSync('git', ['add', '.gitkeep'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });

    await mkdir(pkgDir, { recursive: true });
    await writeFile(path.join(pkgDir, 'old.ts'), 'export const a = 1;\n');
    execFileSync('git', ['add', 'pkg/old.ts'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'add old.ts'], { cwd: dir, stdio: 'ignore' });

    execFileSync('git', ['mv', 'pkg/old.ts', 'pkg/new.ts'], { cwd: dir, stdio: 'ignore' });
    await writeFile(path.join(pkgDir, 'new.ts'), 'export const a = 1;\nexport const b = 2;\n');
    execFileSync('git', ['add', 'pkg/new.ts'], { cwd: dir, stdio: 'ignore' });

    const result = await getGitStatus(dir);
    const tracked = result?.fileStats?.trackedFiles ?? [];
    const renamed = tracked.find((f) => f.fullPath?.endsWith('new.ts'));

    assert.ok(renamed, `expected renamed file in trackedFiles, got ${JSON.stringify(tracked)}`);
    assert.ok(
      renamed?.lineDiff,
      `expected lineDiff on renamed file, got ${JSON.stringify(renamed)}`
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getGitStatus keeps line diffs for literal filenames containing arrow text', {
  skip: process.platform === 'win32' ? 'Windows filenames cannot contain >' : false,
}, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-git-'));
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir, stdio: 'ignore' });

    const fileName = 'foo => bar.txt';
    await writeFile(path.join(dir, fileName), 'one\ntwo\n');
    execFileSync('git', ['add', fileName], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'add literal arrow file'], { cwd: dir, stdio: 'ignore' });

    await writeFile(path.join(dir, fileName), 'one\ntwo\nthree\n');

    const result = await getGitStatus(dir);
    const tracked = result?.fileStats?.trackedFiles ?? [];
    const modified = tracked.find((f) => f.fullPath === fileName);

    assert.ok(modified, `expected literal arrow filename in trackedFiles, got ${JSON.stringify(tracked)}`);
    assert.deepEqual(
      modified?.lineDiff,
      { added: 1, deleted: 0 },
      `expected lineDiff on literal arrow filename, got ${JSON.stringify(modified)}`
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getGitStatus builds branchUrl from HTTPS origin remotes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-git-'));
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['checkout', '-b', 'feature/test-branch'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/example/claude-hud.git'], { cwd: dir, stdio: 'ignore' });

    const result = await getGitStatus(dir);
    assert.equal(result?.branchUrl, 'https://github.com/example/claude-hud/tree/feature/test-branch');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getGitStatus builds branchUrl from SSH origin remotes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-git-'));
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['checkout', '-b', 'feature/test-branch'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:example/claude-hud.git'], { cwd: dir, stdio: 'ignore' });

    const result = await getGitStatus(dir);
    assert.equal(result?.branchUrl, 'https://github.com/example/claude-hud/tree/feature/test-branch');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getGitStatus links an untagged detached HEAD to its commit', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-git-'));
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
    const fullSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
    execFileSync('git', ['checkout', '--detach', fullSha], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/example/claude-hud.git'], { cwd: dir, stdio: 'ignore' });

    const result = await getGitStatus(dir);
    const shortSha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
    assert.equal(result?.branch, `detached:${shortSha}`);
    assert.equal(result?.branchUrl, `https://github.com/example/claude-hud/commit/${shortSha}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getGitStatus does not build branchUrl for non-GitHub HTTPS remotes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-git-'));
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['checkout', '-b', 'feature/test-branch'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['remote', 'add', 'origin', 'https://gitlab.com/example/claude-hud.git'], { cwd: dir, stdio: 'ignore' });

    const result = await getGitStatus(dir);
    assert.equal(result?.branchUrl, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getGitStatus does not build branchUrl for non-GitHub SSH remotes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-git-'));
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['checkout', '-b', 'feature/test-branch'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['remote', 'add', 'origin', 'git@gitlab.com:example/claude-hud.git'], { cwd: dir, stdio: 'ignore' });

    const result = await getGitStatus(dir);
    assert.equal(result?.branchUrl, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
