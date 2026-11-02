// The only code that runs a program other than Node itself, and the only code that works out a path.
// (hud.mjs runs Node: the cage, or Bun's relay. install.mjs writes the statusLine setting.) Logic
// (src/) runs caged and asks for probes by name (see createProbes); it never chooses a command line,
// and it learns every path from logicPaths.
// Imports nothing from src/: this file's behaviour must not change when logic does.
import { exec, execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import nodeModule from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
export const GIT_MAX_OUTPUT_BYTES = 1024 * 1024;
const TREE_KILL_TIMEOUT_MS = 1000;
const WORKER_STARTUP_MS = 1500;

// ---- Paths. Every path the HUD uses is worked out here and handed to logic as data (logicPaths),
// so logic never knows a file this file doesn't grant. Must stay loadable on old Node, so `hud
// doctor` can explain what to upgrade.

const expandHome = (p, home) => (p === '~' ? home : p.startsWith('~/') || p.startsWith('~\\') ? path.join(home, p.slice(2)) : p);

// os.homedir() reads this process's environment; a caller may pass another one.
const homeOf = (env) => (process.platform === 'win32' ? env.USERPROFILE : env.HOME) || os.homedir();

export function claudePaths(env = process.env, home = homeOf(env)) {
  const custom = env.CLAUDE_CONFIG_DIR?.trim();
  const configDir = custom ? path.resolve(expandHome(custom, home)) : path.join(home, '.claude');
  const hudDir = path.join(configDir, 'plugins', 'claude-hud');
  return {
    home,
    configDir,
    hudDir,
    claudeJson: custom ? path.join(configDir, '.claude.json') : path.join(home, '.claude.json'),
    dataDir: path.join(hudDir, 'data'),
    strippedDir: path.join(hudDir, 'stripped'),
    configPath: path.join(hudDir, 'config.json'),
    // Outside plugins/, which users often symlink across several config dirs, so it stays per-directory.
    overridePath: path.join(configDir, 'claude-hud.json'),
    undoPath: path.join(hudDir, 'config.undo.json'),
    heartbeat: path.join(hudDir, 'heartbeat.json'),
  };
}

export const samePath = (a, b) => {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
};

/**
 * Every file logic may read, by name. hud.mjs grants exactly these (plus logic's own code) and sends
 * this same object to logic, which reads nothing else. Never .credentials.json. `input` is a stdin
 * payload: its cwd names the project, its transcript_path the session.
 */
export function logicPaths(paths, input) {
  const absolute = (p) => (typeof p === 'string' && path.isAbsolute(p) ? p : null);
  const cwd = absolute(input?.cwd);
  const transcript = absolute(input?.transcript_path);
  const user = { claudeMd: path.join(paths.configDir, 'CLAUDE.md'), rules: path.join(paths.configDir, 'rules'),
    settings: path.join(paths.configDir, 'settings.json') };
  let project = null;
  if (cwd) {
    const dir = path.join(cwd, '.claude');
    // A project whose .claude is the user's config dir: those files count once, as the user's.
    const own = !samePath(dir, paths.configDir);
    project = { claudeMd: path.join(cwd, 'CLAUDE.md'), localMd: path.join(cwd, 'CLAUDE.local.md'), mcpJson: path.join(cwd, '.mcp.json'),
      dotClaudeMd: own ? path.join(dir, 'CLAUDE.md') : null, dotLocalMd: path.join(dir, 'CLAUDE.local.md'),
      rules: own ? path.join(dir, 'rules') : null, settings: own ? path.join(dir, 'settings.json') : null,
      localSettings: path.join(dir, 'settings.local.json') };
  }
  return {
    data: paths.dataDir, config: paths.configPath, override: paths.overridePath, heartbeat: paths.heartbeat, claudeJson: paths.claudeJson,
    user, project, transcript,
    subagents: transcript && path.join(path.dirname(transcript), path.basename(transcript, '.jsonl'), 'subagents'),
  };
}

/** The read grants for a cage run: logic's own code and every path in `named`. Rule counting walks real paths, so rules dirs add their targets. */
export function readGrants(root, named) {
  const flat = (value) => (value && typeof value === 'object' ? Object.values(value).flatMap(flat) : typeof value === 'string' ? [value] : []);
  const grants = [root, ...flat(named)];
  for (const rules of [named.user?.rules, named.project?.rules].filter(Boolean)) {
    try { grants.push(fs.realpathSync(rules)); } catch { /* missing */ }
  }
  return [...new Set(grants)];
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

// ---- stripped/: logic's code without its types. Logic reads it and never writes it.

/** A stripped file is named by its source and the Node that stripped it, so a change to either makes a new one. */
export const strippedName = (source) => `${crypto.hash('sha256', `${process.version}\0${source}`)}.js`;

// Node warns on stderr the first time stripTypeScriptTypes runs; that would land in `/hud doctor`.
function strip(source) {
  const emitWarning = process.emitWarning;
  process.emitWarning = () => {};
  try {
    return nodeModule.stripTypeScriptTypes(source);
  } finally {
    process.emitWarning = emitWarning;
  }
}

/**
 * Node strips types every time it loads a .ts file, and on Node 22 it can't cache the result. That
 * was most of a render. So each src/ file is stripped once, by Node's own stripper, into `dir`.
 * `dir` is outside data/, so logic can never change code it will run later.
 * Returns { dir, files: { <URL path under root>: <file name in dir> } } for fence.mjs to load
 * from, or null if `dir` can't be written; then Node strips as before.
 */
export function stripLogic(dir, root) {
  try {
    if (fs.lstatSync(dir, { throwIfNoEntry: false })?.isSymbolicLink()) fs.rmSync(dir);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const rootUrl = pathToFileURL(path.join(root, path.sep)).href;
    const files = {};
    for (const file of fs.readdirSync(path.join(root, 'src'), { recursive: true })) {
      if (!file.endsWith('.ts')) continue;
      const sourcePath = path.join(root, 'src', file);
      const source = fs.readFileSync(sourcePath, 'utf8');
      const name = strippedName(source);
      files[pathToFileURL(sourcePath).href.slice(rootUrl.length)] = name;
      const target = path.join(dir, name);
      if (fs.existsSync(target)) continue;
      fs.writeFileSync(`${target}.${process.pid}.tmp`, strip(source), { mode: 0o600 });
      fs.renameSync(`${target}.${process.pid}.tmp`, target);
    }
    // Files an older version left. A render that loses one in a race gets Node's own strip.
    const current = new Set(Object.values(files));
    for (const name of fs.readdirSync(dir)) if (!current.has(name)) fs.rmSync(path.join(dir, name), { force: true });
    return { dir, files };
  } catch {
    return null;
  }
}

// ---- Config keys that name files outside data/. Read only from the user's own config files.

function readJsonObject(file, maxBytes = 64 * 1024) {
  try {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
      if (!fs.fstatSync(fd).isFile() || fs.fstatSync(fd).size > maxBytes) return null;
      const value = JSON.parse(fs.readFileSync(fd, 'utf8'));
      return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

/** Reads the user's own config values, claude-hud.json over config.json key by key, for the few keys this file needs. */
export function userSettings(paths) {
  const files = [readJsonObject(paths.overridePath), readJsonObject(paths.configPath)];
  return (section, key) => files.find((f) => f?.[section] && typeof f[section] === 'object' && key in f[section])?.[section][key];
}

/** display.externalUsagePath and externalUsageWritePath. */
export function usagePaths(paths, env = process.env, setting = userSettings(paths)) {
  return resolveUsagePaths({ read: setting('display', 'externalUsagePath'), write: setting('display', 'externalUsageWritePath') }, paths.home, env);
}

/**
 * The probes worth starting before logic asks, so git runs while logic's Node starts. Only a
 * guess at what logic will want: a wrong one costs a wasted run or a missed head start, never output.
 */
export function probesToStart(setting) {
  return setting('gitStatus', 'enabled') === false || setting('jjStatus', 'enabled') === true ? [] : ['git.status'];
}

/** Absolute paths only, with ~ and ${VAR} expanded; the write path must end in .json. Logic only ever sees the raw strings. */
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
  // GIT_NO_LAZY_FETCH: a partial clone fetches missing blobs on its own, through the repo's own transport config.
  return { ...base, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never', GIT_NO_LAZY_FETCH: '1' };
}

/** Run git and resolve with its stdout. Rejects on non-zero exit, timeout, or oversized output. */
export function runGit(cwd, args, timeout, platform = process.platform) {
  if (platform === 'win32') {
    const gitExecutable = resolveWindowsExecutable('git');
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

/**
 * Resolve <name>.exe from absolute PATH entries only. Windows looks for a bare program name in the
 * folder it runs in before PATH, and that folder is the user's repo, so git and jj never run by bare name.
 */
export function resolveWindowsExecutable(name, environment = process.env, resolveCandidate = (candidate) => {
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
    const resolved = resolveCandidate(path.win32.join(entry, `${name}.exe`));
    if (resolved && path.win32.isAbsolute(resolved)) return resolved;
  }
  return null;
}

/**
 * A repository's own config is as untrusted as its files, and git runs commands it names. Each
 * kind is shut whole rather than key by key:
 *   - the network: protocol.allow=never (and GIT_NO_LAZY_FETCH) stops every transport, so a
 *     partial clone's lazy fetch can't reach core.sshCommand, credential helpers or url rewrites
 *   - core.fsmonitor, which runs on every status
 *   - filter drivers, which run whenever git hashes a changed file. Drivers from the user's
 *     global or system config keep working (git-lfs). A repo driver whose name isn't plain
 *     ([\w.-]) can't be named back in `-c` (bytes that aren't UTF-8, an `=`), so git isn't run.
 * The probes also pass --ignore-submodules=dirty, since git inside a submodule reads its config.
 */
async function untrustedConfigOverrides(cwd) {
  const overrides = ['-c', 'core.quotePath=false', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'protocol.allow=never'];
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
    if (!/^[\w.-]+$/.test(name)) throw new Error('a repo filter driver git could not be told to skip');
    drivers.add(name);
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

// ---- `hud` subcommands: what logic can't look up from inside the cage, and the one file `set` writes.

/** Type stripping, --permission and module.registerHooks are all unflagged from Node 22.18. */
export const isNodeSupported = (version) => {
  const [major, minor] = String(version).replace(/^v/, '').split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 18);
};

/**
 * Node installs already on disk, from the version managers' own folders, so `/hud` can point the
 * status line at one that is new enough. Lists folders only and runs nothing.
 */
function findRuntimes(env = process.env, home = os.homedir(), platform = process.platform) {
  const exe = platform === 'win32' ? 'node.exe' : path.join('bin', 'node');
  const managers = [
    ['nvm', path.join(env.NVM_DIR || path.join(home, '.nvm'), 'versions', 'node'), ''],
    ['nvm-windows', env.NVM_HOME || path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'nvm'), 'win'],
    ['fnm', path.join(env.FNM_DIR || path.join(home, platform === 'darwin' ? 'Library/Application Support' : '.local/share', 'fnm'), 'node-versions'), 'installation'],
    ['mise', path.join(env.MISE_DATA_DIR || path.join(home, '.local', 'share', 'mise'), 'installs', 'node'), ''],
    ['asdf', path.join(env.ASDF_DATA_DIR || path.join(home, '.asdf'), 'installs', 'nodejs'), ''],
    ['volta', path.join(env.VOLTA_HOME || path.join(home, '.volta'), 'tools', 'image', 'node'), ''],
  ];
  const found = [];
  for (const [manager, dir, inner] of managers) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { /* not installed */ }
    for (const name of names) {
      if (!/^v?\d+\.\d+\.\d+$/.test(name)) continue;
      const file = inner === 'win' ? path.join(dir, name, 'node.exe') : path.join(dir, name, inner, exe);
      if (fs.existsSync(file)) found.push({ manager, version: name.replace(/^v/, ''), path: file, supported: isNodeSupported(name) });
    }
  }
  const system = platform === 'win32'
    ? [path.join(env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe')]
    : ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'];
  for (const file of system) if (fs.existsSync(file)) found.push({ manager: 'system', version: '', path: file, supported: null });
  return found;
}

/** Records each render for `hud doctor`: when Claude Code last ran it, on which runtime, how it went, and its input. */
export function writeHeartbeat(paths, { outcome, stdin = null, now = Date.now(), env = process.env }) {
  const columns = Number.parseInt(env.COLUMNS ?? '', 10);
  const record = { at: now, runtime: process.versions.bun ? `bun ${process.versions.bun}` : process.version, path: process.execPath,
    outcome, columns: columns > 0 ? columns : null, stdin };
  try {
    fs.mkdirSync(paths.hudDir, { recursive: true });
    const tmp = `${paths.heartbeat}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(record), { mode: 0o600 });
    fs.renameSync(tmp, paths.heartbeat);
  } catch { /* a read-only home has no heartbeat */ }
}

/** Everything a subcommand gets from outside the cage. Plain JSON, and safe to gather on old Node. */
export function commandFacts({ root, paths, env = process.env, cwd = process.cwd() }) {
  const pkg = readJsonObject(path.join(root, 'package.json'));
  return {
    runtime: { name: process.versions.bun ? 'bun' : 'node', version: process.versions.bun ?? process.versions.node, path: process.execPath,
      supported: !process.versions.bun && isNodeSupported(process.versions.node) },
    runtimes: findRuntimes(env, paths.home),
    plugin: { root, version: typeof pkg?.version === 'string' ? pkg.version : null },
    configPath: paths.configPath,
    undoPath: paths.undoPath,
    cwd,
    heartbeat: readJsonObject(paths.heartbeat, 512 * 1024),
  };
}

// Keys that name files the collector reads or writes. Logic can't set them; only the user's own edit can.
const CAPABILITY_KEYS = ['externalUsagePath', 'externalUsageWritePath'];

/**
 * Writes the config `hud set` produced, after keeping the old file as the undo copy. The keys that
 * name files always keep their value from disk, whatever logic returned.
 */
export function writeConfig(paths, config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('not a config object');
  const onDisk = readJsonObject(paths.configPath)?.display ?? {};
  const { display: returned, ...next } = config;
  const display = { ...(returned && typeof returned === 'object' ? returned : {}) };
  for (const key of CAPABILITY_KEYS) {
    delete display[key];
    if (Object.hasOwn(onDisk, key)) display[key] = onDisk[key];
  }
  if (Object.keys(display).length > 0) next.display = display;
  fs.mkdirSync(paths.hudDir, { recursive: true });
  fs.writeFileSync(paths.undoPath, fs.existsSync(paths.configPath) ? fs.readFileSync(paths.configPath) : '{}\n', { mode: 0o600 });
  replaceFile(paths.configPath, `${JSON.stringify(next, null, 2)}\n`);
}

/** `hud set --undo`: swaps config.json with the copy the last `set` kept. */
export function undoConfig(paths) {
  const previous = fs.readFileSync(paths.undoPath, 'utf8');
  const current = fs.existsSync(paths.configPath) ? fs.readFileSync(paths.configPath, 'utf8') : '{}\n';
  replaceFile(paths.configPath, previous);
  fs.writeFileSync(paths.undoPath, current, { mode: 0o600 });
}

// Writes through a symlink (config.json is often in a dotfiles repo) and keeps the file private.
function replaceFile(file, text) {
  const target = fs.existsSync(file) ? fs.realpathSync(file) : file;
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, target);
}

// ---- The menu logic picks from

/** Every probe logic may ask for, bound to this render's inputs. Each resolves to plain JSON. */
export function createProbes({ cwd, argv = process.argv, env = process.env, usage = { read: null, write: null }, early = [] }) {
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
      const jj = process.platform === 'win32' ? resolveWindowsExecutable('jj') : 'jj';
      return dir && jj ? run(jj, JJ_ARGS, { cwd: dir, timeout: 2000, maxBuffer: 16 * 1024 }) : null;
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
  // Each probe runs at most once per render, whether started early or asked for.
  const started = new Map();
  const once = (name) => {
    if (!started.has(name)) started.set(name, probes[name]());
    return started.get(name);
  };
  const ask = async (names) => {
    const answers = {};
    await Promise.all([...new Set(Array.isArray(names) ? names : [])]
      .filter((name) => typeof name === 'string' && Object.hasOwn(probes, name))
      .map(async (name) => { answers[name] = await once(name); }));
    return answers;
  };
  // hud.mjs calls this once logic's Node is starting, so `early` (see probesToStart) runs meanwhile.
  ask.start = () => early.forEach(once);
  return ask;
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
