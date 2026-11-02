// Runs inside the real cage in place of src/main.ts (see escape.check.mjs). Each case tries one
// thing logic must not be able to do, against temp dirs and a local listener only, and reports
// whether it got through. It speaks hud.mjs's channel itself rather than importing src/channel.ts,
// so no agent-owned code can change what it reports. Cases 1-21 are the user-runtime critic's matrix.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// The first line on fd 0 is hud.mjs's input: { stdin, now, paths }. The fence took away process.stdin.
function readInput() {
  const chunk = Buffer.alloc(64 * 1024);
  let text = '';
  while (!text.includes('\n')) {
    const n = fs.readSync(0, chunk, 0, chunk.length, null);
    if (n === 0) break;
    text += chunk.subarray(0, n).toString('utf8');
  }
  return JSON.parse(text.slice(0, text.indexOf('\n')));
}

const { stdin, paths } = readInput();
const t = { ...stdin.matrix, dataDir: paths.data };
const results = [];

const connect = (Socket) => new Promise((resolve, reject) => {
  const socket = new Socket();
  socket.on('error', reject);
  socket.connect(t.port, '127.0.0.1', () => {
    socket.end();
    resolve('connected');
  });
  setTimeout(() => reject(new Error('no connection')), 1500);
});

async function check(name, attempt) {
  try {
    const detail = await attempt();
    results.push(`ESCAPED ${name}: ${typeof detail === 'function' ? 'function' : String(detail).split('\n')[0].slice(0, 60)}`);
  } catch (error) {
    results.push(`blocked ${name}: ${error?.code ?? ''} ${String(error?.message ?? error).split('\n')[0].slice(0, 80)}`.trimEnd());
  }
}
const importAny = (specifier) => import(specifier);

// 1-3: files outside the grants.
await check('01 write ~/.bashrc', () => fs.appendFileSync(path.join(t.home, '.bashrc'), '# marker\n'));
await check('02 write outside data/', () => fs.writeFileSync(path.join(t.outside, 'poke.txt'), 'x'));
await check('03 read .credentials.json', () => fs.readFileSync(t.secret, 'utf8').length);
// 4-6: child processes.
await check('04 import node:child_process', async () => (await importAny('node:child_process')).execFileSync('git', ['--version']));
await check('05 createRequire child_process', async () => (await importAny('node:module')).createRequire(import.meta.url)('node:child_process'));
await check('06 getBuiltinModule child_process', () => process.getBuiltinModule('node:child_process').execFileSync('git', ['--version']));
// 7-12: network.
await check('07 import node:net + connect', async () => connect((await importAny('node:net')).Socket));
await check('08 import node:dgram', async () => (await importAny('node:dgram')).createSocket('udp4'));
await check('09 import node:http', async () => (await importAny('node:http')).request);
await check('10 import node:tls', async () => (await importAny('node:tls')).connect);
await check('11 fetch', async () => (await globalThis.fetch(`http://127.0.0.1:${t.port}/`)).status);
await check('12 WebSocket', () => new globalThis.WebSocket(`ws://127.0.0.1:${t.port}/`));
// 13-16: process internals.
await check('13 process.binding', () => process.binding('spawn_sync'));
await check('14 process["bind"+"ing"]', () => process['bind' + 'ing']('fs'));
await check('15 process.dlopen', () => process.dlopen({ exports: {} }, path.join(t.outside, 'x.node')));
await check('16 process.kill', () => process.kill(process.pid, 0));
// 17-19: code from strings.
await check('17 eval', () => eval('1 + 1'));
await check('18 new Function', () => new Function('return 2 + 2')());
await check('19 constructor chain', () => (() => {}).constructor('return 3')());
// 20-21: loaders.
await check('20 import data: URL', () => importAny('data:text/javascript,export default 1'));
await check('21 require via module.constructor', () => globalThis.module.constructor._load('node:child_process'));

// Found while building the cage.
await check('22 stdio stream socket connect', () => connect(process.stdout.constructor));
await check('23 console stream socket connect', () => connect(console._stdout.constructor));
await check('24 process.execve', () => process.execve('/bin/sh', ['sh', '-c', 'true']));
await check('25 symlink data/ -> outside', () => fs.symlinkSync(path.join(t.outside, 'poke.txt'), path.join(t.dataDir, 'link')));
await check('26 hard link outside -> data/', () => fs.linkSync(t.secret, path.join(t.dataDir, 'hard')));
await check('27 write a prefix sibling of data/', () => fs.writeFileSync(path.join(t.sibling, 'poke.txt'), 'x'));
await check('28 rename out of data/', () => {
  fs.writeFileSync(path.join(t.dataDir, 'move.txt'), 'x');
  fs.renameSync(path.join(t.dataDir, 'move.txt'), path.join(t.outside, 'moved.txt'));
});
await check('29 import node:worker_threads', async () => new (await importAny('node:worker_threads')).Worker('1', { eval: true }));
await check('30 import node:inspector', async () => (await importAny('node:inspector')).open());
await check('31 import node:module', async () => (await importAny('node:module')).registerHooks);
await check('32 import a module outside the plugin', () => importAny(t.outsideModule));
await check('33 process.report to outside', () => process.report.writeReport(path.join(t.outside, 'report.json')));
await check('34 tokens in the environment', () => {
  const leaked = Object.entries(process.env).filter(([, value]) => value?.includes('fake-token'));
  if (leaked.length === 0) throw new Error('none');
  return leaked.map(([name]) => name).join(',');
});
await check('35 PATH in the environment', () => {
  if (!process.env.PATH) throw new Error('empty');
  return process.env.PATH;
});

// 36-40: logic must never write anything it later runs, and never run anything but the plugin's code.
await check('36 write into stripped/', () => fs.writeFileSync(path.join(t.stripped, 'poke.js'), 'x'));
await check('37 rename from data/ into stripped/', () => {
  fs.writeFileSync(path.join(t.dataDir, 'move.js'), 'x');
  fs.renameSync(path.join(t.dataDir, 'move.js'), path.join(t.stripped, 'move.js'));
});
// A module logic wrote in data/ that records whether it ran.
const planted = path.join(t.dataDir, 'planted.mjs');
fs.writeFileSync(planted, 'globalThis.plantedRan = true;\n');
const ran = () => {
  if (!globalThis.plantedRan) throw new Error('did not run');
  globalThis.plantedRan = false;
  return 'planted module ran';
};
await check('38 poison String.prototype.slice, import from data/', async () => {
  const slice = String.prototype.slice;
  const root = new URL('../../', import.meta.url).href;
  String.prototype.slice = function (...args) {
    return args[0] === 0 && args[1] === root.length ? root : slice.apply(this, args);
  };
  try {
    await importAny(pathToFileURL(planted).href).catch(() => {});
  } finally {
    String.prototype.slice = slice;
  }
  return ran();
});
await check('39 poison fs.readFileSync, swap the code fence.mjs loads', async () => {
  const readFileSync = fs.readFileSync;
  fs.readFileSync = (file, ...rest) => (String(file).includes('stripped') ? 'globalThis.plantedRan = true;\n' : readFileSync(file, ...rest));
  try {
    await importAny('../../src/cost.ts').catch(() => {});
  } finally {
    fs.readFileSync = readFileSync;
  }
  return ran();
});
// Node 24 runs a transpile-cache entry in place of the .ts it was made from, and its checksum is a
// plain crc32, so a cache inside data/ would let logic plant code for the next render.
await check('40 a compile cache logic can write', () => {
  if (!process.env.NODE_COMPILE_CACHE) throw new Error('none');
  return process.env.NODE_COMPILE_CACHE;
});

// 41-46: from the verify lane's matrix.
await check('41 process._linkedBinding', () => process._linkedBinding('x'));
await check('42 process.chdir', () => process.chdir(t.outside) ?? process.cwd());
await check('43 import node:vm', async () => (await importAny('node:vm')).runInNewContext('1 + 1'));
await check('44 write outside via fs/promises', () => fs.promises.writeFile(path.join(t.outside, 'p'), 'x').then(() => 'wrote'));
await check('45 import node:http2', async () => (await importAny('node:http2')).connect);
// escape.check.mjs plants data/planted-link -> outside before the render; collector.mjs must sweep it.
await check('46 write through a symlink planted in data/', () => fs.writeFileSync(path.join(t.dataDir, 'planted-link', 'x'), 'x') ?? 'wrote');

// The control: the one write logic is allowed. If this fails, the cases above prove nothing.
let control;
try {
  fs.writeFileSync(path.join(t.dataDir, 'control'), 'ok');
  control = 'control wrote inside data/';
} catch (error) {
  control = `control could not write inside data/: ${error?.code ?? error}`;
}
fs.writeSync(1, `${JSON.stringify({ lines: [...results, control] })}\n`);
