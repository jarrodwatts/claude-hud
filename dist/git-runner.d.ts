import { spawn, type ChildProcess } from 'node:child_process';
export declare const GIT_MAX_OUTPUT_BYTES: number;
export declare class GitTimeoutError extends Error {
}
export declare function createGitEnvironment(base?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
/** Run git and resolve with its stdout. Rejects on non-zero exit, timeout, or oversized output. */
export declare function runGit(cwd: string, args: readonly string[], timeout: number, platform?: NodeJS.Platform): Promise<string>;
/**
 * Windows does not kill a process's children when it dies, so a statusline
 * cancelled mid-render would orphan git.exe. Git runs under a one-shot worker
 * that tree-kills it when the IPC channel to this process closes, whether
 * because we gave up waiting or because we were killed.
 */
export declare function runGitInWorker(gitExecutable: string, cwd: string, args: readonly string[], timeout: number): Promise<string>;
type KillableChild = Pick<ChildProcess, 'pid' | 'exitCode' | 'signalCode' | 'kill'>;
/** Kill the process tree rooted at `child` with taskkill, falling back to killing just the child. */
export declare function terminateWindowsProcessTree(child: KillableChild, spawnImpl?: typeof spawn, environment?: NodeJS.ProcessEnv): Promise<void>;
/** System32\taskkill.exe under a drive-absolute SystemRoot, never a PATH lookup a repo could plant. */
export declare function resolveTaskkillPath(environment?: NodeJS.ProcessEnv): string | null;
type ResolveCandidate = (candidate: string) => string | null;
/** Resolve git.exe from absolute PATH entries only, so a git.exe in the repo cwd is never picked up. */
export declare function resolveWindowsGitExecutable(environment?: NodeJS.ProcessEnv, resolveCandidate?: ResolveCandidate): string | null;
export {};
//# sourceMappingURL=git-runner.d.ts.map