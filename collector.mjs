// The only code that runs programs or touches files outside data/ for the HUD. Logic (src/) runs
// caged and asks for probes by name (see createProbes); it never chooses a command line or a path.
// Imports nothing from src/: this file's behaviour must not change when logic does.
import { exec, execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
export const GIT_MAX_OUTPUT_BYTES = 1024 * 1024;
const TREE_KILL_TIMEOUT_MS = 1000;
const WORKER_STARTUP_MS = 1500;

// ---- Paths. These match src/claude-config-dir.ts, which logic uses to find the same files.

const expandHome = (p, home) => (p === '~' ? home : p.startsWith('~/') || p.startsWith('~\\') ? path.join(home, p.slice(2)) : p);

export function claudePaths(env = process.env, home = os.homedir()) {
  const custom = env.CLAUDE_CONFIG_DIR?.trim();
  const configDir = custom ? path.resolve(expandHome(custom, home)) : path.join(home, '.claude');
  const hudDir = path.join(configDir, 'plugins', 'claude-hud');
  return {
    home,
    configDir,
    hudDir,
    claudeJson: custom ? path.join(configDir, '.claude.json') : path.join(home, '.claude.json'),
    dataDir: path.join(hudDir, 'data'),
  };
}

// ---- data/: the one directory logic may write.

const MOVED_INTO_DATA = ['daily-cost.json', 'speed-cache', 'transcript-cursors'];

/** Creates data/, moves state from older releases into it, and removes any symlink inside it. Returns its real path. */
export function prepareDataDir({ hudDir, dataDir }) {
  if (fs.lstatSync(dataDir, { throwIfNoEntry: false })?.isSymbolicLink()) fs.rmSync(dataDir);
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  for (const name of MOVED_INTO_DATA) {
    const from = path.join(hudDir, name);
    const to = path.join(dataDir, name);
    if (fs.existsSync(from) && !fs.existsSync(to)) fs.renameSync(from, to);
  }
  // Node's permission model follows a symlink that already exists inside a write grant.
  const sweep = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) fs.rmSync(full, { force: true });
      else if (entry.isDirectory()) sweep(full);
    }
  };
  sweep(dataDir);
  return fs.realpathSync(dataDir);
}

/** What logic may read: its own code, data/, the transcript, and the settings files it counts. Never .credentials.json. */
export function readGrants({ root, dataDir, paths, stdin }) {
  const { configDir, hudDir, claudeJson } = paths;
  const dirs = (base) => [path.join(base, 'CLAUDE.md'), path.join(base, 'CLAUDE.local.md'), path.join(base, 'settings.json'),
    path.join(base, 'settings.local.json'), path.join(base, 'rules')];
  const grants = [root, dataDir, path.join(hudDir, 'config.json'), path.join(configDir, 'claude-hud.json'), claudeJson, ...dirs(configDir)];
  const cwd = typeof stdin?.cwd === 'string' && path.isAbsolute(stdin.cwd) ? stdin.cwd : null;
  if (cwd) grants.push(path.join(cwd, 'CLAUDE.md'), path.join(cwd, 'CLAUDE.local.md'), path.join(cwd, '.mcp.json'), ...dirs(path.join(cwd, '.claude')));
  const transcript = stdin?.transcript_path;
  if (typeof transcript === 'string' && path.isAbsolute(transcript)) {
    grants.push(transcript, path.join(path.dirname(transcript), path.basename(transcript, '.jsonl'), 'subagents'));
  }
  // Rule counting walks real paths, so a symlinked rules directory needs its target too.
  for (const rules of grants.filter((p) => path.basename(p) === 'rules')) {
    try { grants.push(fs.realpathSync(rules)); } catch { /* missing */ }
  }
  return [...new Set(grants)];
}

// ---- Config keys that name files outside data/. Read only from the user's own config files.

function readJsonObject(file) {
  try {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
      if (!fs.fstatSync(fd).isFile() || fs.fstatSync(fd).size > 64 * 1024) return null;
      const value = JSON.parse(fs.readFileSync(fd, 'utf8'));
      return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

/** display.externalUsagePath and externalUsageWritePath; claude-hud.json overrides config.json key by key. */
export function usagePaths(paths, env = process.env) {
  const files = [readJsonObject(path.join(paths.configDir, 'claude-hud.json')), readJsonObject(path.join(paths.hudDir, 'config.json'))];
  const pick = (key) => files.find((f) => f?.display && typeof f.display === 'object' && key in f.display)?.display[key];
  return resolveUsagePaths({ read: pick('externalUsagePath'), write: pick('externalUsageWritePath') }, paths.home, env);
}

/** Absolute paths only, with ~ and ${VAR} expanded as src/config.ts does; the write path must end in .json. */
export function resolveUsagePaths({ read, write }, home = os.homedir(), env = process.env) {
  const resolve = (value) => {
    const expanded = typeof value === 'string'
      ? expandHome(value.trim(), home).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, name) => env[name] ?? m)
      : '';
    return path.isAbsolute(expanded) ? path.normalize(expanded) : null;
  };
  const target = resolve(write);
  return { read: resolve(read), write: target && path.extname(target).toLowerCase() === '.json' ? target : null };
}

function readText(file, maxBytes = 1024 * 1024) {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() && stat.size <= maxBytes ? { text: fs.readFileSync(file, 'utf8'), mtimeMs: stat.mtimeMs } : null;
  } catch {
    return null;
  }
}

/** Writes the usage snapshot logic returned to the user's chosen path, atomically and privately. */
export function writeUsageSnapshot(target, snapshot, now = Date.now()) {
  if (!target || !snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false;
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${now}.tmp`);
  try {
    if (!fs.statSync(path.dirname(target)).isDirectory()) return false;
    fs.writeFileSync(tmp, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, target);
    fs.chmodSync(target, 0o600);
    return true;
  } catch {
    fs.rmSync(tmp, { force: true });
    return false;
  }
}

// ---- --extra-cmd: an arbitrary shell command, so it needs an explicit opt-in in the environment.

export function isExtraCmdAllowed(env = process.env) {
  return ['1', 'true', 'yes', 'on'].includes(env.CLAUDE_HUD_ALLOW_EXTRA_CMD?.trim().toLowerCase() ?? '');
}

// Accepts `--extra-cmd "cmd"` and `--extra-cmd="cmd"`; the first occurrence wins.
export function parseExtraCmdArg(argv = process.argv, env = process.env) {
  const index = argv.findIndex((arg) => arg === '--extra-cmd' || arg.startsWith('--extra-cmd='));
  if (index === -1 || !isExtraCmdAllowed(env)) return null;
  const arg = argv[index];
  return (arg === '--extra-cmd' ? argv[index + 1] : arg.slice('--extra-cmd='.length)) || null;
}

export function runExtraCmd(cmd, timeout = 3000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout, maxBuffer: 10 * 1024, windowsHide: true }, (error, stdout) => {
      resolve(error ? null : String(stdout).trim() || null);
    });
  });
}

// ---- git

export class GitTimeoutError extends Error {}

export function createGitEnvironment(base = process.env) {
  return { ...base, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' };
}

/** Run git and resolve with its stdout. Rejects on non-zero exit, timeout, or oversized output. */
export function runGit(cwd, args, timeout, platform = process.platform) {
  if (platform === 'win32') {
    const gitExecutable = resolveWindowsGitExecutable();
    if (!gitExecutable) return Promise.reject(new Error('Unable to resolve an absolute git.exe from PATH'));
    return runGitInWorker(gitExecutable, cwd, args, timeout);
  }
  return new Promise((resolve, reject) => {
    execFile('git', [...args], {
      cwd, timeout, maxBuffer: GIT_MAX_OUTPUT_BYTES, encoding: 'utf8', windowsHide: true, shell: false, env: createGitEnvironment(),
    }, (error, stdout) => {
      if (!error) resolve(stdout);
      else reject(error.killed ? new GitTimeoutError(`git ${args.join(' ')} timed out`) : error);
    });
  });
}

/**
 * Windows does not kill a process's children when it dies, so a statusline cancelled mid-render
 * would orphan git.exe. Git runs under a one-shot worker (this file, run with --git-worker) that
 * tree-kills it when the IPC channel to this process closes, whether because we gave up waiting
 * or because we were killed.
 */
export function runGitInWorker(gitExecutable, cwd, args, timeout) {
  return new Promise((resolve, reject) => {
    const worker = spawn(process.execPath, [SELF, '--git-worker', gitExecutable, cwd, ...args], {
      env: createGitEnvironment(), windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'ignore', 'ipc'],
    });
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const settle = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!error) return resolve(Buffer.concat(chunks).toString('utf8'));
      if (worker.connected) worker.disconnect();
      worker.stdout?.destroy();
      worker.unref();
      reject(error);
    };
    const timer = setTimeout(() => settle(new GitTimeoutError(`git ${args.join(' ')} timed out`)), timeout + WORKER_STARTUP_MS);
    worker.stdout?.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > GIT_MAX_OUTPUT_BYTES) settle(new Error(`git output exceeded ${GIT_MAX_OUTPUT_BYTES} bytes`));
      else chunks.push(chunk);
    });
    worker.once('error', (error) => settle(error));
    worker.once('close', (code) => settle(code === 0 ? null : new Error(`git exited with code ${code}`)));
  });
}

/** Kill the process tree rooted at `child` with taskkill, falling back to killing just the child. */
export async function terminateWindowsProcessTree(child, spawnImpl = spawn, environment = process.env) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const pid = child.pid;
  const taskkillPath = resolveTaskkillPath(environment);
  if (!pid || !Number.isSafeInteger(pid) || pid <= 0 || !taskkillPath) {
    child.kill();
    return;
  }
  await new Promise((resolve) => {
    let settled = false;
    let timer;
    const finish = (fallback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (fallback && child.exitCode === null && child.signalCode === null) child.kill();
      resolve();
    };
    let killer;
    try {
      killer = spawnImpl(taskkillPath, ['/PID', String(pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
    } catch {
      child.kill();
      return resolve();
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
export function resolveTaskkillPath(environment = process.env) {
  const systemRoot = environment.SystemRoot ?? environment.SYSTEMROOT;
  if (!systemRoot || systemRoot.includes('\0')) return null;
  if (!/^[A-Za-z]:[\\/]/.test(systemRoot) || !path.win32.isAbsolute(systemRoot)) return null;
  return path.win32.join(path.win32.normalize(systemRoot), 'System32', 'taskkill.exe');
}

/** Resolve git.exe from absolute PATH entries only, so a git.exe in the repo cwd is never picked up. */
export function resolveWindowsGitExecutable(environment = process.env, resolveCandidate = (candidate) => {
  try {
    const resolved = fs.realpathSync(candidate);
    return fs.statSync(resolved).isFile() ? resolved : null;
  } catch {
    return null;
  }
}) {
  const pathValue = Object.entries(environment).find(([key]) => key.toLowerCase() === 'path')?.[1];
  if (!pathValue) return null;
  for (const rawEntry of pathValue.split(path.win32.delimiter)) {
    const entry = rawEntry.trim().replace(/^"(.*)"$/, '$1');
    if (!entry || entry.includes('\0') || !path.win32.isAbsolute(entry)) continue;
    const resolved = resolveCandidate(path.win32.join(entry, 'git.exe'));
    if (resolved && path.win32.isAbsolute(resolved)) return resolved;
  }
  return null;
}

/**
 * A repository's own config is as untrusted as its files, and git runs commands it names:
 * core.fsmonitor on every status, and filter drivers whenever it hashes a changed file. Both
 * are turned off for drivers that don't come from the user's global or system config, so
 * git-lfs keeps working. A driver name git can't take back in `-c` makes git refuse to run.
 * The probes also pass --ignore-submodules=dirty, since git inside a submodule reads its config.
 */
async function untrustedConfigOverrides(cwd) {
  const overrides = ['-c', 'core.quotePath=false', '--no-optional-locks', '-c', 'core.fsmonitor=false'];
  let listed;
  try {
    listed = await runGit(cwd, ['config', '--show-scope', '-z', '--get-regexp', '^filter\\.'], 1000);
  } catch {
    return overrides; // exits 1 when no filter is configured
  }
  const drivers = new Set();
  const fields = listed.split('\0');
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const [scope, entry] = [fields[i], fields[i + 1]];
    if (scope === 'global' || scope === 'system') continue;
    const key = entry.split('\n', 1)[0];
    const name = key.slice('filter.'.length, key.lastIndexOf('.'));
    if (name) drivers.add(name);
  }
  for (const name of drivers) {
    overrides.push('-c', `filter.${name}.clean=`, '-c', `filter.${name}.process=`, '-c', `filter.${name}.required=false`);
  }
  return overrides;
}

// ---- jj

// Walks up from cwd for a `.jj` directory, as jj does, without spawning anything. lstat keeps a
// symlinked marker from pointing jj at a directory that isn't a repo, and a nearer .git ends the
// walk so a nested Git repo never resolves to a parent jj checkout.
export function isJjRepo(cwd) {
  const marker = (p) => {
    try { return fs.lstatSync(p).isDirectory() ? 'directory' : 'other'; } catch { return null; }
  };
  let dir = realDirectory(cwd);
  for (let depth = 0; dir && depth < 64; depth++) {
    if (marker(path.join(dir, '.jj')) === 'directory') return true;
    if (marker(path.join(dir, '.git')) !== null) return false;
    const parent = path.dirname(dir);
    dir = parent === dir ? null : parent;
  }
  return false;
}

function realDirectory(cwd) {
  try {
    const resolved = fs.realpathSync(cwd);
    return fs.lstatSync(resolved).isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

// change id | bookmarks at @ | dirty | conflict, from one read-only `jj log`.
export const JJ_ARGS = ['--ignore-working-copy', '--at-operation=@', '--no-pager', 'log', '-r', '@', '--no-graph', '--color', 'never', '-T',
  'change_id.shortest(8) ++ "\\x1f" ++ self.local_bookmarks().map(|bookmark| bookmark.name()).join("\\x1e") ++ "\\x1f" ++ '
  + 'if(self.empty(), "0", "1") ++ "\\x1f" ++ if(self.conflict(), "1", "0")'];

const run = (file, args, options) => new Promise((resolve) => {
  execFile(file, args, { encoding: 'utf8', windowsHide: true, shell: false, ...options }, (error, stdout) => resolve(error ? null : stdout));
});

// ---- The menu logic picks from

/** Every probe logic may ask for, bound to this render's inputs. Each resolves to plain JSON. */
export function createProbes({ cwd, argv = process.argv, env = process.env, usage = { read: null, write: null } }) {
  const extraCmd = parseExtraCmdArg(argv, env);
  const extra = extraCmd ? runExtraCmd(extraCmd) : Promise.resolve(null);
  let overrides;
  const git = async (args, timeout, safe = true) => {
    if (typeof cwd !== 'string' || !cwd) return null;
    try {
      const prefix = safe ? await (overrides ??= untrustedConfigOverrides(cwd)) : [];
      return { stdout: await runGit(cwd, [...prefix, ...args], timeout) };
    } catch (error) {
      return { error: error instanceof GitTimeoutError ? 'timeout' : 'failed' };
    }
  };
  const probes = {
    'git.status': () => git(['status', '--porcelain=v2', '--branch', '-z', '--ignore-submodules=dirty'], 1000),
    // diff-index, not diff: porcelain diff refreshes stale stat data into .git/index whatever
    // --no-optional-locks says, and a timeout mid-write leaves .git/index.lock behind.
    'git.numstat': () => git(['diff-index', '-M', '--numstat', '-z', '--ignore-submodules=dirty', 'HEAD'], 2000),
    'git.branch': () => git(['rev-parse', '--abbrev-ref', 'HEAD'], 1000, false),
    'git.describe': () => git(['describe', '--tags', '--exact-match', 'HEAD'], 1000, false),
    jj: async () => {
      const dir = typeof cwd === 'string' && isJjRepo(cwd) ? realDirectory(cwd) : null;
      return dir ? run('jj', JJ_ARGS, { cwd: dir, timeout: 2000, maxBuffer: 16 * 1024 }) : null;
    },
    // os.freemem() leaves out reclaimable cache, so logic uses the OS's own accounting where it is cheap.
    memory: async () => {
      if (process.platform === 'linux') return { meminfo: readText('/proc/meminfo')?.text ?? null };
      if (process.platform === 'darwin') return { vmStat: await run('/usr/bin/vm_stat', [], { timeout: 1000 }) };
      return {};
    },
    extra: () => extra,
    'usage.read': () => (usage.read ? readText(usage.read)?.text ?? null : null),
    // The current snapshot, so logic can skip a write that changes nothing. Null when the path can't be written.
    'usage.target': () => {
      if (!usage.write) return null;
      try {
        if (!fs.statSync(path.dirname(usage.write)).isDirectory()) return null;
      } catch {
        return null;
      }
      return readText(usage.write) ?? { text: null, mtimeMs: null };
    },
  };
  return async (names) => {
    const answers = {};
    await Promise.all([...new Set(Array.isArray(names) ? names : [])]
      .filter((name) => typeof name === 'string' && Object.hasOwn(probes, name))
      .map(async (name) => { answers[name] = await probes[name](); }));
    return answers;
  };
}

// ---- Windows git worker: node collector.mjs --git-worker <absolute git path> <cwd> <git args...>
// Git writes straight to the stdout pipe this worker inherited from its parent.

if (process.argv[1] && path.resolve(process.argv[1]) === SELF && process.argv[2] === '--git-worker') {
  const [gitExecutable, cwd, ...args] = process.argv.slice(3);
  const gitName = path.basename(gitExecutable ?? '').toLowerCase();
  if (!gitExecutable || gitExecutable.includes('\0') || !path.isAbsolute(gitExecutable)
    || (gitName !== 'git' && gitName !== 'git.exe') || !cwd) {
    process.exit(2);
  }
  const git = spawn(gitExecutable, args, { cwd, env: createGitEnvironment(), windowsHide: true, shell: false, stdio: ['ignore', 'inherit', 'ignore'] });
  git.once('error', () => process.exit(1));
  git.once('exit', (code) => process.exit(code ?? 1));
  process.once('disconnect', () => {
    void terminateWindowsProcessTree(git).finally(() => process.exit(1));
  });
}
