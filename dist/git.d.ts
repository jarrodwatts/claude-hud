export interface GitStatus {
    branch: string;
    isDirty: boolean;
    ahead: number;
    behind: number;
}
export declare function getGitBranch(cwd?: string): Promise<string | null>;
export declare function getGitStatus(cwd?: string): Promise<GitStatus | null>;
//# sourceMappingURL=git.d.ts.map