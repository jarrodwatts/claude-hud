import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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

    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    const pkgDir = path.join(dir, 'pkg');
    await writeFile(path.join(dir, '.gitkeep'), '');
    execFileSync('git', ['add', '.gitkeep'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });

    await mkdtemp(pkgDir).catch(() => {});
    execFileSync('mkdir', ['-p', pkgDir]);
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
    assert.equal(result?.branchUrl, 'https://github.com/example/claude-hud/tree/feature%2Ftest-branch');
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
    assert.equal(result?.branchUrl, 'https://github.com/example/claude-hud/tree/feature%2Ftest-branch');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
