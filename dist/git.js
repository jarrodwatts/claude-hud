import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpathSync } from 'node:fs';
const execFileAsync = promisify(execFile);
/**
 * Parse `git worktree list --porcelain` output into structured entries.
 * Each worktree block is separated by a blank line.
 */
export function parseWorktreeList(output) {
    const entries = [];
    const blocks = output.trim().split(/\n\n+/);
    for (const block of blocks) {
        if (!block.trim())
            continue;
        const lines = block.trim().split('\n');
        let wtPath = '';
        let branch = null;
        let isBare = false;
        for (const line of lines) {
            if (line.startsWith('worktree ')) {
                wtPath = line.slice('worktree '.length);
            }
            else if (line.startsWith('branch ')) {
                // branch refs/heads/feature/xyz → feature/xyz
                branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
            }
            else if (line === 'bare') {
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
 * Heuristic: if there's exactly one non-bare linked worktree, it's almost
 * certainly the one being actively worked on. With multiple linked worktrees,
 * the most recently added one (last in the list) is used.
 */
export async function resolveWorktreeDir(cwd) {
    try {
        const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd, timeout: 1000, encoding: 'utf8' });
        const entries = parseWorktreeList(stdout);
        if (entries.length < 2) {
            // No linked worktrees — single worktree repo
            return cwd;
        }
        // Normalize cwd for comparison (realpathSync resolves symlinks, e.g. /var → /private/var on macOS)
        let normalizedCwd;
        try {
            normalizedCwd = realpathSync(cwd);
        }
        catch {
            normalizedCwd = cwd;
        }
        // Find linked worktrees (entries whose path differs from cwd)
        const linked = entries.filter((e) => {
            if (e.isBare)
                return false;
            try {
                return realpathSync(e.path) !== normalizedCwd;
            }
            catch {
                return e.path !== normalizedCwd;
            }
        });
        if (linked.length === 0) {
            return cwd;
        }
        // Use the last linked worktree (most recently added)
        return linked[linked.length - 1].path;
    }
    catch {
        return cwd;
    }
}
export async function getGitBranch(cwd) {
    if (!cwd)
        return null;
    try {
        const effectiveCwd = await resolveWorktreeDir(cwd);
        const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: effectiveCwd, timeout: 1000, encoding: 'utf8' });
        return stdout.trim() || null;
    }
    catch {
        return null;
    }
}
export async function getGitStatus(cwd) {
    if (!cwd)
        return null;
    try {
        // Resolve to linked worktree if one exists
        const effectiveCwd = await resolveWorktreeDir(cwd);
        // Get branch name
        const { stdout: branchOut } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: effectiveCwd, timeout: 1000, encoding: 'utf8' });
        const branch = branchOut.trim();
        if (!branch)
            return null;
        // Check for dirty state and parse file stats
        let isDirty = false;
        let fileStats;
        try {
            const { stdout: statusOut } = await execFileAsync('git', ['--no-optional-locks', 'status', '--porcelain'], { cwd: effectiveCwd, timeout: 1000, encoding: 'utf8' });
            const trimmed = statusOut.trim();
            isDirty = trimmed.length > 0;
            if (isDirty) {
                fileStats = parseFileStats(trimmed);
            }
        }
        catch {
            // Ignore errors, assume clean
        }
        // Get ahead/behind counts
        let ahead = 0;
        let behind = 0;
        try {
            const { stdout: revOut } = await execFileAsync('git', ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], { cwd: effectiveCwd, timeout: 1000, encoding: 'utf8' });
            const parts = revOut.trim().split(/\s+/);
            if (parts.length === 2) {
                behind = parseInt(parts[0], 10) || 0;
                ahead = parseInt(parts[1], 10) || 0;
            }
        }
        catch {
            // No upstream or error, keep 0/0
        }
        return { branch, isDirty, ahead, behind, fileStats };
    }
    catch {
        return null;
    }
}
/**
 * Parse git status --porcelain output and count file stats (Starship-compatible format)
 * Status codes: M=modified, A=added, D=deleted, ??=untracked
 */
function parseFileStats(porcelainOutput) {
    const stats = { modified: 0, added: 0, deleted: 0, untracked: 0 };
    const lines = porcelainOutput.split('\n').filter(Boolean);
    for (const line of lines) {
        if (line.length < 2)
            continue;
        const index = line[0]; // staged status
        const worktree = line[1]; // unstaged status
        if (line.startsWith('??')) {
            stats.untracked++;
        }
        else if (index === 'A') {
            stats.added++;
        }
        else if (index === 'D' || worktree === 'D') {
            stats.deleted++;
        }
        else if (index === 'M' || worktree === 'M' || index === 'R' || index === 'C') {
            // M=modified, R=renamed (counts as modified), C=copied (counts as modified)
            stats.modified++;
        }
    }
    return stats;
}
//# sourceMappingURL=git.js.map