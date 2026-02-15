import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { realpathSync, statSync } from 'node:fs';

const execFileAsync = promisify(execFile);

export interface FileStats {
  modified: number;
  added: number;
  deleted: number;
  untracked: number;
}

export interface GitStatus {
  branch: string;
  isDirty: boolean;
  ahead: number;
  behind: number;
  fileStats?: FileStats;
}

interface WorktreeEntry {
  path: string;
  branch: string | null;
  isBare: boolean;
}

/**
 * Parse `git worktree list --porcelain` output into structured entries.
 * Each worktree block is separated by a blank line.
 */
export function parseWorktreeList(output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  const blocks = output.trim().split(/\n\n+/);

  for (const block of blocks) {
    if (!block.trim()) continue;

    const lines = block.trim().split('\n');
    let wtPath = '';
    let branch: string | null = null;
    let isBare = false;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        wtPath = line.slice('worktree '.length);
      } else if (line.startsWith('branch ')) {
        // branch refs/heads/feature/xyz → feature/xyz
        branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
      } else if (line === 'bare') {
        isBare = true;
      }
    }

    if (wtPath) {
      entries.push({ path: wtPath, branch, isBare });
    }
  }

  return entries;
}

/**
 * Resolve the effective git working directory for status queries.
 *
 * When Claude Code starts in the main worktree, `cwd` always points there —
 * even when the user creates a linked worktree and works in it. This function
 * detects linked worktrees and redirects git queries to the active one.
 *
 * Strategy (in priority order):
 * 1. **Session transcript** — check if file paths from this session's tool
 *    operations (Read, Edit, Write) fall under a linked worktree. This is
 *    session-specific and works correctly with parallel sessions.
 * 2. **Git metadata mtime** — fall back to checking each worktree's HEAD file
 *    mtime when no transcript data is available.
 */
export async function resolveWorktreeDir(cwd: string, toolTargets?: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['worktree', 'list', '--porcelain'],
      { cwd, timeout: 1000, encoding: 'utf8' }
    );

    const entries = parseWorktreeList(stdout);
    if (entries.length < 2) {
      // No linked worktrees — single worktree repo
      return cwd;
    }

    // Normalize cwd for comparison (realpathSync resolves symlinks, e.g. /var → /private/var on macOS)
    let normalizedCwd: string;
    try {
      normalizedCwd = realpathSync(cwd);
    } catch {
      normalizedCwd = cwd;
    }

    // Find linked worktrees (entries whose path differs from cwd)
    const linked = entries.filter((e) => {
      if (e.isBare) return false;
      try {
        return realpathSync(e.path) !== normalizedCwd;
      } catch {
        return e.path !== normalizedCwd;
      }
    });

    if (linked.length === 0) {
      return cwd;
    }

    // Strategy 1: Match tool targets from this session's transcript.
    // This is session-specific — each Claude Code session has its own transcript,
    // so parallel sessions won't interfere with each other.
    if (toolTargets && toolTargets.length > 0) {
      const match = matchWorktreeFromTargets(linked, toolTargets);
      if (match) return match;
    }

    // Strategy 2: Single worktree shortcut
    if (linked.length === 1) {
      return linked[0].path;
    }

    // Strategy 3: Fall back to git metadata mtime (global, not session-specific)
    return getMostRecentWorktree(linked);
  } catch {
    return cwd;
  }
}

/**
 * Match a linked worktree by checking if any tool targets (file paths from
 * Read, Edit, Write operations) fall under a worktree directory.
 * Scans from most recent to oldest for the fastest match.
 */
function matchWorktreeFromTargets(worktrees: WorktreeEntry[], targets: string[]): string | null {
  // Build normalized path list for worktrees
  const normalizedWorktrees = worktrees.map((wt) => {
    let normalized: string;
    try {
      normalized = realpathSync(wt.path);
    } catch {
      normalized = wt.path;
    }
    // Ensure trailing slash for prefix matching
    return { original: wt.path, prefix: normalized.endsWith('/') ? normalized : normalized + '/' };
  });

  // Scan targets from most recent to oldest
  for (let i = targets.length - 1; i >= 0; i--) {
    const target = targets[i];
    // Only consider absolute file paths (skip grep patterns, glob patterns, truncated bash commands)
    if (!target || !target.startsWith('/')) continue;

    let normalizedTarget: string;
    try {
      normalizedTarget = realpathSync(target);
    } catch {
      normalizedTarget = target;
    }

    for (const wt of normalizedWorktrees) {
      if (normalizedTarget.startsWith(wt.prefix)) {
        return wt.original;
      }
    }
  }

  return null;
}

/**
 * Pick the most recently active worktree by checking git metadata mtime.
 * For each linked worktree, git maintains a HEAD file under
 * .git/worktrees/<name>/HEAD that is updated on checkout, commit, etc.
 */
function getMostRecentWorktree(worktrees: WorktreeEntry[]): string {
  let best: { path: string; mtime: number } | null = null;

  for (const wt of worktrees) {
    try {
      // Get the worktree's git dir to find its HEAD file
      const gitDirPath = execFileSync(
        'git', ['-C', wt.path, 'rev-parse', '--git-dir'],
        { timeout: 1000, encoding: 'utf8' }
      ).trim();

      // Resolve relative git dir paths against the worktree
      const headPath = gitDirPath.startsWith('/')
        ? `${gitDirPath}/HEAD`
        : `${wt.path}/${gitDirPath}/HEAD`;

      const mtime = statSync(headPath).mtimeMs;
      if (!best || mtime > best.mtime) {
        best = { path: wt.path, mtime };
      }
    } catch {
      // If we can't stat the HEAD, try the worktree directory itself
      try {
        const mtime = statSync(wt.path).mtimeMs;
        if (!best || mtime > best.mtime) {
          best = { path: wt.path, mtime };
        }
      } catch {
        // Skip this worktree
      }
    }
  }

  return best?.path ?? worktrees[worktrees.length - 1].path;
}

export async function getGitBranch(cwd?: string, toolTargets?: string[]): Promise<string | null> {
  if (!cwd) return null;

  try {
    const effectiveCwd = await resolveWorktreeDir(cwd, toolTargets);
    const { stdout } = await execFileAsync(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd: effectiveCwd, timeout: 1000, encoding: 'utf8' }
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function getGitStatus(cwd?: string, toolTargets?: string[]): Promise<GitStatus | null> {
  if (!cwd) return null;

  try {
    // Resolve to linked worktree if one exists
    const effectiveCwd = await resolveWorktreeDir(cwd, toolTargets);

    // Get branch name
    const { stdout: branchOut } = await execFileAsync(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd: effectiveCwd, timeout: 1000, encoding: 'utf8' }
    );
    const branch = branchOut.trim();
    if (!branch) return null;

    // Check for dirty state and parse file stats
    let isDirty = false;
    let fileStats: FileStats | undefined;
    try {
      const { stdout: statusOut } = await execFileAsync(
        'git',
        ['--no-optional-locks', 'status', '--porcelain'],
        { cwd: effectiveCwd, timeout: 1000, encoding: 'utf8' }
      );
      const trimmed = statusOut.trim();
      isDirty = trimmed.length > 0;
      if (isDirty) {
        fileStats = parseFileStats(trimmed);
      }
    } catch {
      // Ignore errors, assume clean
    }

    // Get ahead/behind counts
    let ahead = 0;
    let behind = 0;
    try {
      const { stdout: revOut } = await execFileAsync(
        'git',
        ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'],
        { cwd: effectiveCwd, timeout: 1000, encoding: 'utf8' }
      );
      const parts = revOut.trim().split(/\s+/);
      if (parts.length === 2) {
        behind = parseInt(parts[0], 10) || 0;
        ahead = parseInt(parts[1], 10) || 0;
      }
    } catch {
      // No upstream or error, keep 0/0
    }

    return { branch, isDirty, ahead, behind, fileStats };
  } catch {
    return null;
  }
}

/**
 * Parse git status --porcelain output and count file stats (Starship-compatible format)
 * Status codes: M=modified, A=added, D=deleted, ??=untracked
 */
function parseFileStats(porcelainOutput: string): FileStats {
  const stats: FileStats = { modified: 0, added: 0, deleted: 0, untracked: 0 };
  const lines = porcelainOutput.split('\n').filter(Boolean);

  for (const line of lines) {
    if (line.length < 2) continue;

    const index = line[0];    // staged status
    const worktree = line[1]; // unstaged status

    if (line.startsWith('??')) {
      stats.untracked++;
    } else if (index === 'A') {
      stats.added++;
    } else if (index === 'D' || worktree === 'D') {
      stats.deleted++;
    } else if (index === 'M' || worktree === 'M' || index === 'R' || index === 'C') {
      // M=modified, R=renamed (counts as modified), C=copied (counts as modified)
      stats.modified++;
    }
  }

  return stats;
}
