// Loaded with --import into the caged logic process before any logic code runs. --permission
// bounds the filesystem and child processes; on Node 22/24 it does nothing about the network or
// signals, so this closes those: an import allow list, plus deleting the globals that reach out.
import { Console } from 'node:console';
import fs from 'node:fs';
import { registerHooks } from 'node:module';

// Logic runs in this realm and can rewrite String.prototype, fs or process. So the checks below use
// tables without prototypes and functions taken before logic runs.
const table = (entries) => Object.freeze(Object.assign(Object.create(null), entries));
const ALLOWED = table({ 'node:path': 1, 'node:fs': 1, 'node:fs/promises': 1, 'node:os': 1, 'node:url': 1, 'node:crypto': 1, 'node:readline': 1 });
const ROOT = new URL('./', import.meta.url).href;
const Err = Error;
const slice = Function.prototype.call.bind(String.prototype.slice);
const startsWith = (s, prefix) => typeof s === 'string' && s.length >= prefix.length && slice(s, 0, prefix.length) === prefix;
const allowedBuiltin = (id) => ALLOWED[startsWith(id, 'node:') ? id : `node:${id}`] === 1;

// collector.mjs strips each src/ file once, into a folder logic can read but never write, and
// hud.mjs passes the list: { dir, files: { <URL path under ROOT>: <file name in dir> } }.
// Loading those skips Node's strip.
const stripped = (() => {
  try {
    const { dir, files } = JSON.parse(process.env.CLAUDE_HUD_STRIPPED);
    return { dir: String(dir), files: table(files) };
  } catch {
    return { dir: '', files: table({}) };
  }
})();
const { readFileSync } = fs;

// Checked on the resolved URL, so `net`, `node:net` and data:/http: specifiers are all refused.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    if (startsWith(resolved.url, 'node:') ? !allowedBuiltin(resolved.url) : !startsWith(resolved.url, ROOT)) {
      throw new Err(`fence: ${resolved.url} is not allowed`);
    }
    return resolved;
  },
  load(url, context, nextLoad) {
    const name = startsWith(url, ROOT) ? stripped.files[slice(url, ROOT.length)] : undefined;
    if (typeof name === 'string') {
      try {
        return { format: 'module', source: readFileSync(`${stripped.dir}${name}`, 'utf8'), shortCircuit: true };
      } catch { /* gone in a race with an update: Node strips it */ }
    }
    return nextLoad(url, context);
  },
});

const seal = (object, key, value) => {
  try {
    delete object[key];
  } catch { /* already sealed */ }
  Object.defineProperty(object, key, { value, writable: false, configurable: false, enumerable: false });
};

const getBuiltinModule = process.getBuiltinModule;
if (typeof getBuiltinModule === 'function') {
  seal(process, 'getBuiltinModule', (id) => {
    if (!allowedBuiltin(id)) throw new Err(`fence: ${id} is not allowed`);
    return getBuiltinModule(id);
  });
}
for (const key of ['fetch', 'WebSocket', 'EventSource', 'Navigator', 'navigator']) seal(globalThis, key, undefined);
for (const key of ['binding', '_linkedBinding', 'dlopen', 'kill', '_kill', '_debugProcess', 'execve', 'setuid', 'setgid', 'seteuid',
  'setegid', 'initgroups', 'setgroups', 'chdir', 'loadEnvFile', 'openStdin', 'channel']) seal(process, key, undefined);

// A piped stdio stream is a net.Socket, and its constructor connects anywhere. Logic gets plain
// descriptor writers instead and reads fd 0 with fs (see src/channel.ts).
const writer = (fd) => Object.freeze({
  write(chunk) {
    try {
      fs.writeSync(fd, String(chunk));
    } catch { /* the reader went away */ }
    return true;
  },
  isTTY: false,
});
const stdout = writer(1);
const stderr = writer(2);
seal(process, 'stdout', stdout);
seal(process, 'stderr', stderr);
seal(process, 'stdin', undefined);
seal(globalThis, 'console', new Console({ stdout, stderr, ignoreErrors: false }));
