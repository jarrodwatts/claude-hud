// P1: the escape matrix. Runs a hostile probe as logic inside the real cage and requires every way
// out to be denied. The cage comes from hud.mjs itself, so CI tests the exact flags users run under.
// Contract: hud.mjs exports cage({ logicDir, entry, dataDir }) -> { args, env }, meaning
// spawn(process.execPath, args, { env }), and it renders only when it is the entry point.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const missing = ['hud.mjs', 'fence.mjs'].filter((f) => !fs.existsSync(path.join(root, f)));
if (missing.length) {
  console.log(`skip: no cage yet (${missing.join(', ')} missing); spec step 3 adds it`);
  process.exit(78);
}
const { cage } = await import(pathToFileURL(path.join(root, 'hud.mjs')).href);

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hud-escape-')));
const [logicDir, dataDir, outside] = ['logic', 'data', 'outside'].map((d) => path.join(base, d));
for (const d of [logicDir, dataDir, outside]) fs.mkdirSync(d);
const secret = path.join(outside, '.credentials.json');
fs.writeFileSync(secret, '{"token":"fake-not-a-secret"}');
fs.copyFileSync(new URL('lib/escape-probe.mjs', import.meta.url), path.join(logicDir, 'probe.mjs'));

// A loopback listener: any connection at all is an escape, whatever the probe reports.
let connections = 0;
const server = net.createServer((s) => (connections++, s.destroy()));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
fs.writeFileSync(path.join(logicDir, 'targets.json'), JSON.stringify({ outside, data: dataDir, secret, port: server.address().port }));

const { args, env } = cage({ logicDir, entry: path.join(logicDir, 'probe.mjs'), dataDir });
// Async, so the listener above can see connections while the probe runs.
const run = await new Promise((resolve) => {
  const child = spawn(process.execPath, args, { env });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => (stdout += d));
  child.stderr.on('data', (d) => (stderr += d));
  child.stdin.end('{}');
  const killer = setTimeout(() => child.kill('SIGKILL'), 30_000);
  child.on('close', (status) => {
    clearTimeout(killer);
    resolve({ status, stdout, stderr });
  });
});
server.close();

let report;
try {
  report = JSON.parse(run.stdout.trim().split('\n').pop());
} catch {
  console.log(`FAIL the probe did not finish (exit ${run.status}):\n${run.stdout}${run.stderr}`.slice(0, 3000));
  process.exit(1);
}
const escaped = report.results.filter(([, r]) => r !== 'denied');
for (const [name, r] of report.results) console.log(`${r === 'denied' ? '  ok' : 'FAIL'} ${name}: ${r}`);
const controlOk = report.control === 'wrote inside the data dir';
console.log(`${controlOk ? '  ok' : 'FAIL'} control: ${report.control}`);
if (connections) console.log(`FAIL the loopback listener got ${connections} connection(s)`);
fs.rmSync(base, { recursive: true, force: true });
console.log(`${report.results.length - escaped.length}/${report.results.length} denied on Node ${process.version} ${process.platform}`);
process.exitCode = escaped.length || connections || !controlOk ? 1 : 0;
