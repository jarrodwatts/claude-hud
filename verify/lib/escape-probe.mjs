// Runs as logic inside the cage and tries every known way out. Prints one JSON line:
// { results: [[name, 'denied' | 'ESCAPED: detail']], control } . Targets come from targets.json beside it.
import fs from 'node:fs';
import path from 'node:path';

const t = JSON.parse(fs.readFileSync(new URL('targets.json', import.meta.url), 'utf8'));
const results = [];
const attempt = async (name, fn) => {
  try {
    results.push([name, `ESCAPED: ${String(await fn()).slice(0, 80)}`]);
  } catch {
    results.push([name, 'denied']);
  }
};
const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
const connect = (net) => new Promise((resolve, reject) => {
  const s = net.connect(t.port, '127.0.0.1', () => s.end(resolve('connected')));
  s.on('error', reject);
});

await attempt('write outside the data dir', () => fs.writeFileSync(path.join(t.outside, 'w'), 'x') ?? 'wrote');
await attempt('write outside via fs/promises', () => fs.promises.writeFile(path.join(t.outside, 'p'), 'x').then(() => 'wrote'));
await attempt('symlink out of the data dir, then write', () => {
  fs.symlinkSync(t.outside, path.join(t.data, 'link'));
  fs.writeFileSync(path.join(t.data, 'link', 's'), 'x');
  return 'wrote through link';
});
await attempt('read a credentials file', () => fs.readFileSync(t.secret, 'utf8'));
await attempt('import node:child_process', async () => (await import('node:child_process')).execFileSync('id', { encoding: 'utf8' }));
await attempt('getBuiltinModule child_process', () => process.getBuiltinModule('child_process').execFileSync('id', { encoding: 'utf8' }));
await attempt('createRequire child_process', async () => (await import('node:module')).createRequire(import.meta.url)('child_process').execFileSync('id'));
await attempt('process.binding', () => typeof process.binding('spawn_sync').spawn);
await attempt('process["bind" + "ing"]', () => typeof process['bind' + 'ing']('fs'));
await attempt('process._linkedBinding', () => typeof process._linkedBinding('x'));
await attempt('process.dlopen', () => process.dlopen({}, path.join(t.outside, 'x.node')) ?? 'loaded');
await attempt('process.kill', () => process.kill(process.pid, 0) && 'signalled');
await attempt('process.chdir', () => process.chdir(t.outside) ?? process.cwd());
await attempt('import node:net and connect', async () => Promise.race([connect(await import('node:net')), timeout(1500)]));
await attempt('import node:dgram', async () => typeof (await import('node:dgram')).createSocket);
await attempt('import node:http', async () => typeof (await import('node:http')).request);
await attempt('import node:tls', async () => typeof (await import('node:tls')).connect);
await attempt('import node:worker_threads', async () => new (await import('node:worker_threads')).Worker('1', { eval: true }) && 'worker');
await attempt('import node:inspector', async () => typeof (await import('node:inspector')).open);
await attempt('import node:vm', async () => (await import('node:vm')).runInNewContext('1+1'));
await attempt('import a data: URL', async () => (await import('data:text/javascript,export default "loaded"')).default);
await attempt('fetch to loopback', () => Promise.race([fetch(`http://127.0.0.1:${t.port}/`).then((r) => r.status), timeout(1500)]));
await attempt('WebSocket', () => typeof WebSocket === 'function' ? 'present' : Promise.reject(new Error('absent')));
await attempt('eval', () => eval('1 + 1'));
await attempt('new Function', () => new Function('return 2')());
await attempt('Function via a constructor chain', () => (() => {}).constructor('return 3')());

let control;
try {
  fs.writeFileSync(path.join(t.data, 'control'), 'ok');
  control = 'wrote inside the data dir';
} catch (e) {
  control = `could not write inside the data dir: ${e.code ?? e.message}`;
}
console.log(JSON.stringify({ results, control }));
