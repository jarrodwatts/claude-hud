import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface GitStatus {
  branch: string;
  isDirty: boolean;
  ahead: number;
  behind: number;
}

export async function getGitBranch(cwd?: string): Promise<string | null> {
  if (!cwd) return null;

  try {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd, timeout: 1000, encoding: 'utf8' }
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function getGitStatus(cwd?: string): Promise<GitStatus | null> {
  if (!cwd) return null;

  try {
    // Get branch name
    const { stdout: branchOut } = await execFileAsync(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd, timeout: 1000, encoding: 'utf8' }
    );
    const branch = branchOut.trim();
    if (!branch) return null;

    // Check for dirty state (uncommitted changes)
    let isDirty = false;
    try {
      const { stdout: statusOut } = await execFileAsync(
        'git',
        ['status', '--porcelain'],
        { cwd, timeout: 1000, encoding: 'utf8' }
      );
      isDirty = statusOut.trim().length > 0;
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
        { cwd, timeout: 1000, encoding: 'utf8' }
      );
      const parts = revOut.trim().split(/\s+/);
      if (parts.length === 2) {
        behind = parseInt(parts[0], 10) || 0;
        ahead = parseInt(parts[1], 10) || 0;
      }
    } catch {
      // No upstream or error, keep 0/0
    }

    return { branch, isDirty, ahead, behind };
  } catch {
    return null;
  }
}
