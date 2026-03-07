import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getGitStatus } from './git.js';
import type { FileStats } from './git.js';

const execFileAsync = promisify(execFile);

export type VcsProvider = 'jj' | 'git';
export type VcsPreference = 'auto' | 'git' | 'jj';

export interface VcsStatus {
  provider: VcsProvider;
  branch: string;
  isDirty: boolean;
  ahead: number;
  behind: number;
  fileStats?: FileStats;
  // jj-specific
  changeId?: string;
  description?: string;
  workspace?: string;
}

async function getJjStatus(cwd: string): Promise<VcsStatus | null> {
  try {
    // Get jj log info and diff summary in parallel
    const logPromise = execFileAsync(
      'jj',
      [
        'log', '-r', '@', '--no-graph', '-T',
        'change_id.short(8) ++ "\\n" ++ bookmarks ++ "\\n" ++ if(empty, "clean", "dirty") ++ "\\n" ++ description.first_line()',
      ],
      { cwd, timeout: 2000, encoding: 'utf8' }
    );

    const [logResult] = await Promise.all([logPromise]);

    const lines = logResult.stdout.split('\n');
    const changeId = (lines[0] ?? '').trim();
    const bookmarks = (lines[1] ?? '').trim();
    const dirtyFlag = (lines[2] ?? '').trim();
    const description = (lines[3] ?? '').trim();

    if (!changeId) return null;

    const isDirty = dirtyFlag !== 'clean';

    // Parse bookmark name — jj may show "main*" (with trailing *) for tracking bookmarks
    const rawBookmark = bookmarks.split(/\s+/)[0] ?? '';
    const bookmark = rawBookmark.replace(/\*$/, '');

    const branch = bookmark || changeId;

    // Get file stats if dirty
    let fileStats: FileStats | undefined;
    if (isDirty) {
      try {
        const { stdout: diffOut } = await execFileAsync(
          'jj',
          ['diff', '--summary'],
          { cwd, timeout: 2000, encoding: 'utf8' }
        );
        fileStats = parseJjDiffStats(diffOut.trim());
      } catch {
        // ignore
      }
    }

    // Get workspace name
    let workspace: string | undefined;
    try {
      const { stdout: wsOut } = await execFileAsync(
        'jj',
        ['workspace', 'list'],
        { cwd, timeout: 1000, encoding: 'utf8' }
      );
      const wsName = (wsOut.trim().split('\n')[0] ?? '').split(':')[0]?.trim();
      if (wsName && wsName !== 'default') {
        workspace = wsName;
      }
    } catch {
      // ignore
    }

    return {
      provider: 'jj',
      branch,
      isDirty,
      ahead: 0,
      behind: 0,
      fileStats,
      changeId,
      description: description || undefined,
      workspace,
    };
  } catch {
    return null;
  }
}

function parseJjDiffStats(output: string): FileStats {
  const stats: FileStats = { modified: 0, added: 0, deleted: 0, untracked: 0 };
  if (!output) return stats;

  for (const line of output.split('\n')) {
    const code = line[0];
    if (code === 'M' || code === 'R') {
      stats.modified++;
    } else if (code === 'A') {
      stats.added++;
    } else if (code === 'D') {
      stats.deleted++;
    }
  }

  return stats;
}

export async function getVcsStatus(cwd?: string, preference: VcsPreference = 'auto'): Promise<VcsStatus | null> {
  if (!cwd) return null;

  if (preference === 'jj') {
    return getJjStatus(cwd);
  }

  if (preference === 'git') {
    return wrapGitStatus(cwd);
  }

  // auto: check for .jj/ directory, try jj first
  if (existsSync(join(cwd, '.jj'))) {
    const jjResult = await getJjStatus(cwd);
    if (jjResult) return jjResult;
  }

  return wrapGitStatus(cwd);
}

async function wrapGitStatus(cwd: string): Promise<VcsStatus | null> {
  const git = await getGitStatus(cwd);
  if (!git) return null;

  // Get commit title and worktree info for git
  let description: string | undefined;
  let workspace: string | undefined;

  try {
    const [descResult, worktreeResult] = await Promise.all([
      execFileAsync('git', ['log', '-1', '--format=%s'], { cwd, timeout: 1000, encoding: 'utf8' }).catch(() => null),
      execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd, timeout: 1000, encoding: 'utf8' }).catch(() => null),
    ]);

    if (descResult) {
      const title = descResult.stdout.trim();
      if (title) description = title;
    }

    if (worktreeResult) {
      // Check if we're in a linked worktree (not the main one)
      try {
        const { stdout: gitDir } = await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd, timeout: 1000, encoding: 'utf8' });
        const trimmedGitDir = gitDir.trim();
        // Linked worktrees have .git files pointing to worktrees/<name> inside the main repo
        if (trimmedGitDir.includes('/worktrees/')) {
          const parts = trimmedGitDir.split('/worktrees/');
          const wsName = parts[parts.length - 1]?.replace(/\/$/, '');
          if (wsName) workspace = wsName;
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }

  return {
    provider: 'git',
    branch: git.branch,
    isDirty: git.isDirty,
    ahead: git.ahead,
    behind: git.behind,
    fileStats: git.fileStats,
    description,
    workspace,
  };
}

export async function getUserId(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'claude', ['auth', 'status', '--json'],
      { timeout: 2000, encoding: 'utf8' }
    );
    const data = JSON.parse(stdout);
    const email = data.email as string | undefined;
    if (email && email.includes('@')) {
      return email.split('@')[0];
    }
    return email ?? null;
  } catch {
    // Fallback: try reading credentials file
    try {
      const { readFileSync } = await import('node:fs');
      const { homedir } = await import('node:os');
      const { join: pathJoin } = await import('node:path');
      const credPath = pathJoin(homedir(), '.claude', '.credentials.json');
      const content = readFileSync(credPath, 'utf-8');
      const creds = JSON.parse(content);
      // credentials don't contain email directly, so return null
      return null;
    } catch {
      return null;
    }
  }
}
