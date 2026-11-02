// The status line command. Claude Code runs it after each message with a JSON payload on stdin, and
// ARCHITECTURE.md draws one such render. `node hud.mjs <command>` runs one of the /hud skill's
// subcommands instead (see COMMANDS). Every check under verify/ runs logic through the same runCage.
//
// Every launcher, the one `hud install` copies today included, reaches main() through the stubs
// dist/index.js (Node) and src/index.ts (Bun).
// Keep this file's syntax loadable by old Node and Bun, so they can print the upgrade line.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as collector from './collector.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const LOGIC = path.join(ROOT, 'src', 'main.ts');
const FENCE = pathToFileURL(path.join(ROOT, 'fence.mjs')).href;
const MAX_OUTPUT_BYTES = 64 * 1024;
// The cage's wall stops runaway logic, not slow probes, so it sits well above them. Each probe has its
// own shorter limit, and a slow one blanks only its own element. Git's runs chain: a config read, then
// status and line diffs, then branch or tag on a timeout, each up to 1-2 s plus 1.5 s on Windows for its
// worker to start. The extra command may take 3 s.
const WALL_MS = 10_000;

// CLAUDE_HUD_DISABLE=1 blanks the HUD for one session while keeping the statusLine setting.
export function isHudDisabled(env = process.env) {
  const value = env.CLAUDE_HUD_DISABLE?.trim().toLowerCase();
  return !!value && !['0', 'false', 'off', 'no'].includes(value);
}

const upgradeLine = (runtime) => `claude-hud needs Node 22.18+ (this is ${runtime}). Type /hud to fix it.`;

// ---- What may reach the terminal. One allow list: verify/case.mjs judges output with it too.

// Whole escape sequences (CSI, OSC, other ESC), then single control and bidi characters.
const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[ -/]*[0-~]?|[\x00-\x1f\x7f-\x9f؜‎‏‪-‮⁦-⁩]/g;
const SGR = /^\x1b\[[0-9;]*m$/;
const OSC8 = /^\x1b\]8;;(.*)\x1b\\$/s;
const GITHUB_NAME = /^[A-Za-z0-9_.-]+$/;

/**
 * The filter each line passes on its way to the terminal, for the session in `stdin`. It keeps SGR
 * colour, and OSC 8 links to file: URLs or to pages of the GitHub repo Claude Code reported
 * (stdin.workspace.repo). Every other escape sequence is dropped whole, and every other control or
 * bidi character goes. Logic never decides what reaches the terminal.
 */
export function terminalFilter(stdin) {
  const repo = stdin?.workspace?.repo;
  const pages = repo?.host === 'github.com' && GITHUB_NAME.test(repo.owner ?? '') && GITHUB_NAME.test(repo.name ?? '')
    ? `https://github.com/${repo.owner}/${repo.name}/`
    : null;
  const linkAllowed = (target) => {
    if (target === '') return true; // closes the open link
    try {
      const url = new URL(target);
      // A web link must already be in the parsed form, so no `..` or encoding trick leaves the repo.
      return url.protocol === 'file:' || (pages !== null && url.href === target && target.startsWith(pages));
    } catch {
      return false;
    }
  };
  const keep = (sequence) => {
    const link = OSC8.exec(sequence);
    return SGR.test(sequence) || (link !== null && linkAllowed(link[1]));
  };
  return (line) => String(line).replace(ESCAPES, (sequence) => (keep(sequence) ? sequence : ''));
}

function print(lines, stdin = null) {
  if (lines.length === 0) return;
  const filter = terminalFilter(stdin);
  process.stdout.write(lines.map((line) => `${filter(line)}\n`).join(''));
}

const NO_DATA_TIMEOUT_MS = 250;
const IDLE_TIMEOUT_MS = 250;
const MAX_STDIN_BYTES = 256 * 1024;

// Null for a TTY (setup's manual run), no input, oversized input, or invalid JSON. Resolves as
// soon as the buffered text parses, or after incomplete input goes idle.
export function readStdin(stream = process.stdin) {
  if (stream.isTTY) return Promise.resolve(null);
  return new Promise((resolve) => {
    let raw = '';
    let done = false;
    let idleTimer;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(noDataTimer);
      clearTimeout(idleTimer);
      stream.pause();
      resolve(value);
    };
    const parse = () => {
      try {
        const value = JSON.parse(raw);
        return value !== null && typeof value === 'object' ? value : null;
      } catch {
        return null;
      }
    };
    const noDataTimer = setTimeout(() => {
      if (!raw) finish(null);
    }, NO_DATA_TIMEOUT_MS);
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > MAX_STDIN_BYTES) return finish(null);
      const parsed = parse();
      if (parsed) return finish(parsed);
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => finish(parse()), IDLE_TIMEOUT_MS);
    });
    stream.on('end', () => finish(parse()));
    stream.on('error', () => finish(null));
  });
}

// Logic sees no secrets: no PATH, no tokens. It only learns whether an API key is set, and the
// base URL without credentials or query.
const PASSED_ENV = ['HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'SystemRoot', 'TZ', 'LANG', 'LANGUAGE', 'LC_ALL', 'LC_CTYPE',
  'LC_TIME', 'LC_MESSAGES', 'COLUMNS', 'DEBUG', 'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX'];

export function cageEnv(env = process.env) {
  const caged = { PATH: '' };
  for (const name of PASSED_ENV) if (typeof env[name] === 'string') caged[name] = env[name];
  if (env.ANTHROPIC_API_KEY?.trim()) caged.ANTHROPIC_API_KEY = 'set';
  for (const name of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_BASE_URL']) {
    try {
      const url = new URL(env[name]?.trim() ?? '');
      caged[name] = `${url.origin}${url.pathname}`;
    } catch { /* unset or not a URL */ }
  }
  return caged;
}

/**
 * Node flags for the cage. Never --allow-child-process, --allow-worker, --allow-addons or --allow-wasi.
 * --disallow-code-generation-from-strings only stops eval and new Function. It is no wall: logic could
 * write a module and import it. The wall is fence.mjs, which loads nothing from outside the plugin,
 * while data/, the one place logic writes, is never inside the plugin. For the same reason there is no
 * compile cache logic can write: Node trusts a cache entry by its crc32, so such a cache would let it
 * plant code for the next render. The one cache, stripped/, is written by collector.mjs and only read
 * by logic. `audit` swaps --permission for --permission-audit: nothing is denied, and fence.mjs
 * reports each access outside the grants.
 */
export function cageArgs({ grants, dataDir, entry = LOGIC, audit = false }) {
  return [audit ? '--permission-audit' : '--permission', ...grants.map((grant) => `--allow-fs-read=${grant}`),
    ...(dataDir ? [`--allow-fs-write=${dataDir}`] : []), '--disallow-code-generation-from-strings', `--import=${FENCE}`, entry];
}

const isInside = (file, dir) => {
  const relative = path.relative(dir, file);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
};

/**
 * The one way logic runs: for a render, for a subcommand, and for every check under verify/.
 *   stdin    Claude Code's payload, or null       now    the render's one clock reading
 *   probes   names => answers: collector.createProbes for a real render, recorded facts in the corpus
 *   env      the environment; its HOME and CLAUDE_CONFIG_DIR place data/ and every path logic reads
 *   entry    the logic to run (the escape matrix runs its probe instead)
 *   audit    see cageArgs
 *   command  a /hud subcommand, { name, args, facts }, instead of a render
 * Resolves with logic's { lines, snapshot?, config?, failed? }, plus `outside` (the accesses outside
 * the grants) in audit mode.
 */
export async function runCage({ stdin = null, now = Date.now(), probes = async () => ({}), env = process.env, entry = LOGIC, audit = false, command }) {
  const paths = collector.claudePaths(env);
  let dataDir = null;
  try {
    dataDir = collector.prepareDataDir(paths);
  } catch { /* a read-only home only costs the caches and the cost ledger */ }
  if (dataDir && isInside(dataDir, fs.realpathSync(ROOT))) dataDir = null;
  // A subcommand's project is the folder Claude Code ran it in.
  const named = collector.logicPaths(paths, command ? { ...stdin, cwd: command.facts.cwd } : stdin);
  if (dataDir) named.data = dataDir;
  const stripped = collector.stripLogic(paths.strippedDir, ROOT);
  const grants = collector.readGrants(ROOT, { ...named, stripped: stripped?.dir });

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, cageArgs({ grants, dataDir, entry, audit }), {
      env: { ...cageEnv(env), ...(stripped ? { CLAUDE_HUD_STRIPPED: JSON.stringify({ dir: path.join(stripped.dir, path.sep), files: stripped.files }) } : {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let settled = false;
    let output = null;
    let stderr = '';
    const settle = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.end();
      if (error) {
        child.kill('SIGKILL');
        reject(error);
      } else {
        resolve(value);
      }
    };
    const timer = setTimeout(() => settle(new Error('timed out')), WALL_MS);
    const send = (message) => {
      if (!settled) child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    let buffered = '';
    let bytes = 0;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_OUTPUT_BYTES) return settle(new Error('output too large'));
      buffered += chunk;
      for (let newline = buffered.indexOf('\n'); newline !== -1; newline = buffered.indexOf('\n')) {
        let message;
        try {
          message = JSON.parse(buffered.slice(0, newline));
        } catch {
          return settle(new Error('unreadable output'));
        }
        buffered = buffered.slice(newline + 1);
        if (Array.isArray(message?.lines)) {
          output = { lines: message.lines.map(String), snapshot: message.snapshot, config: message.config, failed: message.failed === true };
          // In audit mode the report comes as logic exits, which closing its input makes it do.
          if (audit) child.stdin.end();
          else return settle(null, output);
        } else if (Number.isSafeInteger(message?.id)) {
          Promise.resolve().then(() => probes(message.ask)).catch(() => ({})).then((answers) => send({ id: message.id, answers }));
        }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      if (audit) stderr = (stderr + chunk).slice(-MAX_OUTPUT_BYTES);
      if (env.DEBUG) process.stderr.write(chunk);
    });
    child.stdin.on('error', () => {});
    child.on('error', (error) => settle(error));
    child.on('close', (code) => {
      if (!output) return settle(new Error(`logic exited with code ${code}`));
      const report = stderr.split('\n').findLast((line) => line.startsWith('claude-hud audit '));
      settle(null, audit ? { ...output, outside: report ? JSON.parse(report.slice('claude-hud audit '.length)) : ['no audit report'] } : output);
    });
    probes.start?.(); // after the spawn: logic's startup is the long pole
    send({ stdin, now, paths: named, ...(command ? { command } : {}) });
  });
}

// Bun has no permission model, so logic always runs on Node: hand the whole run to `node`, found the
// way the collector finds git (on Windows, only in absolute PATH entries, never the repo's folder).
function relayToNode(argv) {
  const node = process.platform === 'win32' ? collector.resolveWindowsExecutable('node') : 'node';
  return new Promise((resolve) => {
    if (!node) {
      print([upgradeLine(`Bun ${process.versions.bun}`)]);
      return resolve();
    }
    const child = spawn(node, [path.join(ROOT, 'hud.mjs'), ...argv.slice(2)], { stdio: 'inherit' });
    child.on('error', () => resolve(print([upgradeLine(`Bun ${process.versions.bun}`)])));
    child.on('close', (code) => {
      if (code) process.exitCode = code;
      resolve();
    });
  });
}

// The /hud skill's subcommands. All but install run as logic in the cage, like a render.
const COMMANDS = ['doctor', 'schema', 'preview', 'set', 'report', 'install'];
// The skill reads doctor's and report's answers as facts without asking (doctor before the model reads a
// word), so hud.mjs writes those answers as JSON itself. Whatever logic says stays inside JSON strings,
// one line each, and can't pass for the skill's own text. Prose comes out as an array of its lines.
const FACTS = ['doctor', 'report'];

export function asJson(lines) {
  let value;
  try {
    value = JSON.parse(lines.join('\n'));
  } catch {
    value = lines;
  }
  return JSON.stringify(value, null, 2).split('\n');
}

async function runCommand(name, args, { paths, env }) {
  const facts = collector.commandFacts({ root: ROOT, paths, env });
  const printJson = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  if (!facts.runtime.supported) {
    // Old Node can't run the cage, but doctor can still say what to upgrade to.
    if (name === 'doctor') {
      const { runtime, plugin, runtimes, heartbeat } = facts;
      return printJson({
        runtime, plugin, runtimes,
        lastRender: heartbeat && { at: heartbeat.at, runtime: heartbeat.runtime, path: heartbeat.path, outcome: heartbeat.outcome },
        findings: [`This is ${runtime.name} ${runtime.version}; the HUD needs Node 22.18+. Fix: rerun with a supported runtime from runtimes, or install one.`],
      });
    }
    process.exitCode = 1;
    return print([upgradeLine(process.version)]);
  }
  try {
    if (name === 'install') return printJson((await import('./install.mjs')).install({ configDir: paths.configDir, argv: args, env }));
    if (name === 'set' && args[0] === '--undo') {
      collector.undoConfig(paths);
      return print(['Restored config.json from before the last `hud set`.']);
    }
    // The last render's input, saved by hud.mjs from Claude Code, so preview and report can replay it.
    const stdin = facts.heartbeat?.stdin ?? null;
    const probes = collector.createProbes({ cwd: stdin?.cwd, argv: [], env, usage: collector.usagePaths(paths, env) });
    const output = await runCage({ stdin, env, probes, command: { name, args, facts } });
    // Only `set`, which Claude Code asks the user about, may change config; the rest are pre-approved.
    if (name === 'set' && output.config) collector.writeConfig(paths, output.config);
    if (output.failed) process.exitCode = 1;
    print(FACTS.includes(name) ? asJson(output.lines) : output.lines, stdin);
  } catch (error) {
    process.exitCode = 1;
    print([`claude-hud ${name}: ${error instanceof Error ? error.message : 'Unknown error'}`]);
  }
}

export async function main({ argv = process.argv, env = process.env } = {}) {
  const command = COMMANDS.includes(argv[2]) ? argv[2] : null;
  if (!command && isHudDisabled(env)) return;
  if (process.versions.bun) return relayToNode(argv);
  const paths = collector.claudePaths(env);
  if (command) return runCommand(command, argv.slice(3), { paths, env });
  if (!collector.isNodeSupported(process.versions.node)) {
    collector.writeHeartbeat(paths, { outcome: 'upgrade', env });
    return print([upgradeLine(process.version)]);
  }

  const now = Date.now();
  let stdin = null;
  try {
    stdin = await readStdin();
    const setting = collector.userSettings(paths);
    const usage = collector.usagePaths(paths, env, setting);
    const probes = collector.createProbes({ cwd: stdin?.cwd, argv, env, usage, early: collector.probesToStart(setting) });
    const output = await runCage({ stdin, now, probes, env });
    if (output.snapshot) collector.writeUsageSnapshot(usage.write, output.snapshot);
    print(output.lines, stdin);
    // Without input this is a person running the command by hand; keep Claude Code's last render.
    if (stdin) collector.writeHeartbeat(paths, { outcome: output.failed ? output.lines[0] ?? 'failed' : 'ok', stdin, now, env });
  } catch (error) {
    const message = `[claude-hud] Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    print([`${message}. Type /hud to fix it.`]);
    collector.writeHeartbeat(paths, { outcome: message, stdin, now, env });
  }
}

const ENTRIES = [path.join(ROOT, 'hud.mjs'), path.join(ROOT, 'dist', 'index.js'), path.join(ROOT, 'src', 'index.ts')];
if (process.argv[1] && ENTRIES.some((entry) => collector.samePath(process.argv[1], entry))) {
  await main();
}
