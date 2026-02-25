import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
export async function getGitBranch(cwd) {
    if (!cwd)
        return null;
    try {
        const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeout: 1000, encoding: 'utf8' });
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
        const opts = { cwd, timeout: 1000, encoding: 'utf8' };
        // Run all git commands in parallel for faster execution
        const [branchResult, statusResult, revListResult] = await Promise.allSettled([
            execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], opts),
            execFileAsync('git', ['--no-optional-locks', 'status', '--porcelain'], opts),
            execFileAsync('git', ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], opts),
        ]);
        // Branch is required
        if (branchResult.status !== 'fulfilled')
            return null;
        const branch = branchResult.value.stdout.trim();
        if (!branch)
            return null;
        // Parse dirty state and file stats (optional)
        let isDirty = false;
        let fileStats;
        if (statusResult.status === 'fulfilled') {
            const trimmed = statusResult.value.stdout.trim();
            isDirty = trimmed.length > 0;
            if (isDirty) {
                fileStats = parseFileStats(trimmed);
            }
        }
        // Parse ahead/behind counts (optional)
        let ahead = 0;
        let behind = 0;
        if (revListResult.status === 'fulfilled') {
            const parts = revListResult.value.stdout.trim().split(/\s+/);
            if (parts.length === 2) {
                behind = parseInt(parts[0], 10) || 0;
                ahead = parseInt(parts[1], 10) || 0;
            }
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