import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const GIT_MAX_OUTPUT_BYTES = 1024 * 1024;
const TREE_KILL_TIMEOUT_MS = 1000;
const WORKER_STARTUP_MS = 1500;
const WORKER_PATH = fileURLToPath(new URL('./windows-git-worker.js', import.meta.url));

export class GitTimeoutError extends Error {}

export function createGitEnvironment(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...base,
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'Never',
  };
}

/** Run git and resolve with its stdout. Rejects on non-zero exit, timeout, or oversized output. */
export function runGit(
  cwd: string,
  args: readonly string[],
  timeout: number,
  platform: NodeJS.Platform = process.platform,
): Promise<string> {
  if (platform === 'win32') {
    const gitExecutable = resolveWindowsGitExecutable();
    if (!gitExecutable) return Promise.reject(new Error('Unable to resolve an absolute git.exe from PATH'));
    return runGitInWorker(gitExecutable, cwd, args, timeout);
  }

  return new Promise((resolve, reject) => {
    execFile('git', [...args], {
      cwd,
      timeout,
      maxBuffer: GIT_MAX_OUTPUT_BYTES,
      encoding: 'utf8',
      windowsHide: true,
      shell: false,
      env: createGitEnvironment(),
    }, (error, stdout) => {
      if (!error) resolve(stdout);
      else reject(error.killed ? new GitTimeoutError(`git ${args.join(' ')} timed out`) : error);
    });
  });
}

/**
 * Windows does not kill a process's children when it dies, so a statusline
 * cancelled mid-render would orphan git.exe. Git runs under a one-shot worker
 * that tree-kills it when the IPC channel to this process closes, whether
 * because we gave up waiting or because we were killed.
 */
export function runGitInWorker(
  gitExecutable: string,
  cwd: string,
  args: readonly string[],
  timeout: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = spawn(process.execPath, [WORKER_PATH, gitExecutable, cwd, ...args], {
      env: createGitEnvironment(),
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'ignore', 'ipc'],
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;

    const settle = (error: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!error) {
        resolve(Buffer.concat(chunks).toString('utf8'));
        return;
      }
      if (worker.connected) worker.disconnect();
      worker.stdout?.destroy();
      worker.unref();
      reject(error);
    };

    const timer = setTimeout(
      () => settle(new GitTimeoutError(`git ${args.join(' ')} timed out`)),
      timeout + WORKER_STARTUP_MS,
    );
    worker.stdout?.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > GIT_MAX_OUTPUT_BYTES) settle(new Error(`git output exceeded ${GIT_MAX_OUTPUT_BYTES} bytes`));
      else chunks.push(chunk);
    });
    worker.once('error', (error) => settle(error));
    worker.once('close', (code) => settle(code === 0 ? null : new Error(`git exited with code ${code}`)));
  });
}

type KillableChild = Pick<ChildProcess, 'pid' | 'exitCode' | 'signalCode' | 'kill'>;

/** Kill the process tree rooted at `child` with taskkill, falling back to killing just the child. */
export async function terminateWindowsProcessTree(
  child: KillableChild,
  spawnImpl: typeof spawn = spawn,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const pid = child.pid;
  const taskkillPath = resolveTaskkillPath(environment);
  if (!pid || !Number.isSafeInteger(pid) || pid <= 0 || !taskkillPath) {
    child.kill();
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (fallback: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (fallback && child.exitCode === null && child.signalCode === null) child.kill();
      resolve();
    };

    let killer: ChildProcess;
    try {
      killer = spawnImpl(taskkillPath, ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        shell: false,
        stdio: 'ignore',
      });
    } catch {
      child.kill();
      resolve();
      return;
    }

    timer = setTimeout(() => {
      killer.kill();
      finish(true);
    }, TREE_KILL_TIMEOUT_MS);
    killer.once('error', () => finish(true));
    killer.once('exit', (code) => finish(code !== 0));
  });
}

/** System32\taskkill.exe under a drive-absolute SystemRoot, never a PATH lookup a repo could plant. */
export function resolveTaskkillPath(environment: NodeJS.ProcessEnv = process.env): string | null {
  const systemRoot = environment.SystemRoot ?? environment.SYSTEMROOT;
  if (!systemRoot || systemRoot.includes('\0')) return null;
  if (!/^[A-Za-z]:[\\/]/.test(systemRoot) || !path.win32.isAbsolute(systemRoot)) return null;
  return path.win32.join(path.win32.normalize(systemRoot), 'System32', 'taskkill.exe');
}

type ResolveCandidate = (candidate: string) => string | null;

/** Resolve git.exe from absolute PATH entries only, so a git.exe in the repo cwd is never picked up. */
export function resolveWindowsGitExecutable(
  environment: NodeJS.ProcessEnv = process.env,
  resolveCandidate: ResolveCandidate = (candidate) => {
    try {
      const resolved = realpathSync(candidate);
      return statSync(resolved).isFile() ? resolved : null;
    } catch {
      return null;
    }
  },
): string | null {
  const pathValue = Object.entries(environment)
    .find(([key]) => key.toLowerCase() === 'path')?.[1];
  if (!pathValue) return null;

  for (const rawEntry of pathValue.split(path.win32.delimiter)) {
    const entry = rawEntry.trim().replace(/^"(.*)"$/, '$1');
    if (!entry || entry.includes('\0') || !path.win32.isAbsolute(entry)) continue;
    const resolved = resolveCandidate(path.win32.join(entry, 'git.exe'));
    if (resolved && path.win32.isAbsolute(resolved)) return resolved;
  }
  return null;
}
