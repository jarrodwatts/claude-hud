import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getGitBranch, getGitStatus, parseWorktreeList, resolveWorktreeDir } from '../dist/git.js';

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

// parseWorktreeList tests
test('parseWorktreeList parses single worktree', () => {
  const output = `worktree /home/user/project\nHEAD abc123\nbranch refs/heads/main\n`;
  const result = parseWorktreeList(output);
  assert.equal(result.length, 1);
  assert.equal(result[0].path, '/home/user/project');
  assert.equal(result[0].branch, 'main');
  assert.equal(result[0].isBare, false);
});

test('parseWorktreeList parses multiple worktrees', () => {
  const output = [
    'worktree /home/user/project',
    'HEAD abc123',
    'branch refs/heads/main',
    '',
    'worktree /home/user/project-feature',
    'HEAD def456',
    'branch refs/heads/feature/cool-thing',
    '',
  ].join('\n');
  const result = parseWorktreeList(output);
  assert.equal(result.length, 2);
  assert.equal(result[0].path, '/home/user/project');
  assert.equal(result[0].branch, 'main');
  assert.equal(result[1].path, '/home/user/project-feature');
  assert.equal(result[1].branch, 'feature/cool-thing');
});

test('parseWorktreeList handles bare worktree', () => {
  const output = `worktree /home/user/project.git\nHEAD abc123\nbare\n`;
  const result = parseWorktreeList(output);
  assert.equal(result.length, 1);
  assert.equal(result[0].isBare, true);
  assert.equal(result[0].branch, null);
});

test('parseWorktreeList handles detached HEAD', () => {
  const output = [
    'worktree /home/user/project',
    'HEAD abc123',
    'branch refs/heads/main',
    '',
    'worktree /home/user/project-detached',
    'HEAD def456',
    'detached',
    '',
  ].join('\n');
  const result = parseWorktreeList(output);
  assert.equal(result.length, 2);
  assert.equal(result[1].branch, null);
});

test('parseWorktreeList returns empty array for empty input', () => {
  assert.deepEqual(parseWorktreeList(''), []);
  assert.deepEqual(parseWorktreeList('  \n  '), []);
});

// resolveWorktreeDir tests
test('resolveWorktreeDir returns cwd for non-git directory', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-nowt-'));
  try {
    const result = await resolveWorktreeDir(dir);
    assert.equal(result, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveWorktreeDir returns cwd when no linked worktrees exist', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-wt-'));
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });

    const result = await resolveWorktreeDir(dir);
    assert.equal(result, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveWorktreeDir returns linked worktree path when one exists', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-wt-'));
  const wtDir = dir + '-linked';
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });

    // Create a linked worktree
    execFileSync('git', ['worktree', 'add', '-b', 'feature/test', wtDir], { cwd: dir, stdio: 'ignore' });

    // When queried from main worktree, should resolve to linked worktree
    const result = await resolveWorktreeDir(dir);
    assert.equal(await realpath(result), await realpath(wtDir));
  } finally {
    // Clean up worktree before removing directories
    try { execFileSync('git', ['worktree', 'remove', wtDir], { cwd: dir, stdio: 'ignore' }); } catch {}
    await rm(dir, { recursive: true, force: true });
    await rm(wtDir, { recursive: true, force: true });
  }
});

test('getGitBranch returns linked worktree branch when queried from main', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-wt-'));
  const wtDir = dir + '-linked';
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });

    // Create a linked worktree on feature branch
    execFileSync('git', ['worktree', 'add', '-b', 'feature/awesome', wtDir], { cwd: dir, stdio: 'ignore' });

    // Query from main worktree should return the linked worktree's branch
    const branch = await getGitBranch(dir);
    assert.equal(branch, 'feature/awesome');
  } finally {
    try { execFileSync('git', ['worktree', 'remove', wtDir], { cwd: dir, stdio: 'ignore' }); } catch {}
    await rm(dir, { recursive: true, force: true });
    await rm(wtDir, { recursive: true, force: true });
  }
});

test('getGitStatus returns linked worktree branch and dirty state', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-wt-'));
  const wtDir = dir + '-linked';
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });

    // Create linked worktree and make it dirty
    execFileSync('git', ['worktree', 'add', '-b', 'fix/bug', wtDir], { cwd: dir, stdio: 'ignore' });
    await writeFile(path.join(wtDir, 'dirty.txt'), 'uncommitted');

    // Query from main worktree should show linked worktree's state
    const result = await getGitStatus(dir);
    assert.equal(result?.branch, 'fix/bug');
    assert.equal(result?.isDirty, true);
  } finally {
    try { execFileSync('git', ['worktree', 'remove', wtDir, '--force'], { cwd: dir, stdio: 'ignore' }); } catch {}
    await rm(dir, { recursive: true, force: true });
    await rm(wtDir, { recursive: true, force: true });
  }
});

// Transcript-based worktree detection tests (session-specific)
test('resolveWorktreeDir picks worktree matching tool targets over mtime', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-wt-'));
  const wtDir1 = dir + '-linked1';
  const wtDir2 = dir + '-linked2';
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });

    // Create two linked worktrees
    execFileSync('git', ['worktree', 'add', '-b', 'feature/first', wtDir1], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['worktree', 'add', '-b', 'feature/second', wtDir2], { cwd: dir, stdio: 'ignore' });

    // Simulate tool targets pointing to worktree 1 (not the most recent one)
    const realWtDir1 = await realpath(wtDir1);
    const toolTargets = [
      `${realWtDir1}/src/index.ts`,  // Read target
      `${realWtDir1}/src/utils.ts`,  // Edit target
    ];

    // Should pick worktree 1 based on transcript, NOT worktree 2 based on mtime
    const result = await resolveWorktreeDir(dir, toolTargets);
    assert.equal(await realpath(result), realWtDir1);
  } finally {
    try { execFileSync('git', ['worktree', 'remove', wtDir1], { cwd: dir, stdio: 'ignore' }); } catch {}
    try { execFileSync('git', ['worktree', 'remove', wtDir2], { cwd: dir, stdio: 'ignore' }); } catch {}
    await rm(dir, { recursive: true, force: true });
    await rm(wtDir1, { recursive: true, force: true });
    await rm(wtDir2, { recursive: true, force: true });
  }
});

test('resolveWorktreeDir ignores non-absolute tool targets', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-wt-'));
  const wtDir1 = dir + '-linked1';
  const wtDir2 = dir + '-linked2';
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });

    execFileSync('git', ['worktree', 'add', '-b', 'feature/first', wtDir1], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['worktree', 'add', '-b', 'feature/second', wtDir2], { cwd: dir, stdio: 'ignore' });

    // Non-absolute targets (grep patterns, glob patterns, truncated bash commands)
    const toolTargets = ['*.ts', 'function\\s+', 'npm run build...'];

    // Should fall back to mtime since no absolute paths match
    const result = await resolveWorktreeDir(dir, toolTargets);
    // Just verify it returns a valid worktree path, not cwd
    assert.notEqual(await realpath(result), await realpath(dir));
  } finally {
    try { execFileSync('git', ['worktree', 'remove', wtDir1], { cwd: dir, stdio: 'ignore' }); } catch {}
    try { execFileSync('git', ['worktree', 'remove', wtDir2], { cwd: dir, stdio: 'ignore' }); } catch {}
    await rm(dir, { recursive: true, force: true });
    await rm(wtDir1, { recursive: true, force: true });
    await rm(wtDir2, { recursive: true, force: true });
  }
});

test('resolveWorktreeDir falls back to mtime when no tool targets provided', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-wt-'));
  const wtDir1 = dir + '-linked1';
  const wtDir2 = dir + '-linked2';
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });

    execFileSync('git', ['worktree', 'add', '-b', 'feature/first', wtDir1], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['worktree', 'add', '-b', 'feature/second', wtDir2], { cwd: dir, stdio: 'ignore' });

    // No tool targets — should fall back to mtime-based detection
    const result = await resolveWorktreeDir(dir);
    // Should return one of the linked worktrees, not main
    const realResult = await realpath(result);
    assert.ok(
      realResult === await realpath(wtDir1) || realResult === await realpath(wtDir2),
      `Expected one of the linked worktrees, got ${realResult}`
    );
  } finally {
    try { execFileSync('git', ['worktree', 'remove', wtDir1], { cwd: dir, stdio: 'ignore' }); } catch {}
    try { execFileSync('git', ['worktree', 'remove', wtDir2], { cwd: dir, stdio: 'ignore' }); } catch {}
    await rm(dir, { recursive: true, force: true });
    await rm(wtDir1, { recursive: true, force: true });
    await rm(wtDir2, { recursive: true, force: true });
  }
});

test('getGitStatus uses toolTargets to pick correct worktree', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-wt-'));
  const wtDir1 = dir + '-linked1';
  const wtDir2 = dir + '-linked2';
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });

    execFileSync('git', ['worktree', 'add', '-b', 'feature/first', wtDir1], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['worktree', 'add', '-b', 'feature/second', wtDir2], { cwd: dir, stdio: 'ignore' });

    // Tool targets point to worktree 1
    const realWtDir1 = await realpath(wtDir1);
    const toolTargets = [`${realWtDir1}/src/file.ts`];

    const result = await getGitStatus(dir, toolTargets);
    assert.equal(result?.branch, 'feature/first');
  } finally {
    try { execFileSync('git', ['worktree', 'remove', wtDir1], { cwd: dir, stdio: 'ignore' }); } catch {}
    try { execFileSync('git', ['worktree', 'remove', wtDir2], { cwd: dir, stdio: 'ignore' }); } catch {}
    await rm(dir, { recursive: true, force: true });
    await rm(wtDir1, { recursive: true, force: true });
    await rm(wtDir2, { recursive: true, force: true });
  }
});
