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
export declare function parseWorktreeList(output: string): WorktreeEntry[];
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
export declare function resolveWorktreeDir(cwd: string): Promise<string>;
export declare function getGitBranch(cwd?: string): Promise<string | null>;
export declare function getGitStatus(cwd?: string): Promise<GitStatus | null>;
export {};
//# sourceMappingURL=git.d.ts.map