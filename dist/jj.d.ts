import type { GitStatus } from './git.js';
export interface JjRunnerOptions {
    cwd: string;
    timeout: number;
    maxBuffer: number;
    encoding: 'utf8';
    windowsHide: boolean;
    shell: false;
}
export type JjRunner = (file: string, args: readonly string[], options: JjRunnerOptions) => Promise<{
    stdout: string;
}>;
export declare function isJjRepo(cwd?: string): boolean;
export declare function getJjStatus(cwd?: string, runner?: JjRunner): Promise<GitStatus | null>;
//# sourceMappingURL=jj.d.ts.map