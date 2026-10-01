export interface LineDiff {
    added: number;
    deleted: number;
}
export interface TrackedFile {
    basename: string;
    fullPath: string;
    type: 'modified' | 'added' | 'deleted';
    lineDiff?: LineDiff;
}
export interface FileStats {
    modified: number;
    added: number;
    deleted: number;
    untracked: number;
    trackedFiles: TrackedFile[];
}
export interface GitStatus {
    branch: string;
    isDirty: boolean;
    ahead: number;
    behind: number;
    fileStats?: FileStats;
    lineDiff?: LineDiff;
    branchUrl?: string;
    /** Which VCS produced this status. Omitted (undefined) means 'git'. */
    vcs?: 'git' | 'jj';
    /** jj-native: true when the working-copy commit has an unresolved conflict. */
    conflict?: boolean;
}
/** The `workspace.repo` identity Claude Code parses from the origin remote. */
export interface GitRepoIdentity {
    host?: string;
    owner?: string;
    name?: string;
}
export interface GitStatusOptions {
    lineDiffs?: boolean;
    repo?: GitRepoIdentity | null;
}
export declare function getGitStatus(cwd?: string, options?: GitStatusOptions): Promise<GitStatus | null>;
interface ParsedStatus {
    oid: string | null;
    head: string | null;
    ahead: number;
    behind: number;
    dirty: boolean;
    fileStats: FileStats;
}
export declare function parseStatus(output: string): ParsedStatus;
export declare function parseNumstat(output: string): Map<string, LineDiff>;
export {};
//# sourceMappingURL=git.d.ts.map