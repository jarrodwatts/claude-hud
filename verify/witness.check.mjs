// P1 witness: renders every corpus case through the real cage with Node's permission model in audit
// mode. Enforce mode hides a violation as a silently missing segment; audit mode lets the render run
// and records each access outside the grants. Any record fails. Uses hud.mjs's cage() (see escape.check.mjs).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateCase } from './case.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const entry = path.join(root, 'src', 'main.ts');
const missing = ['hud.mjs', 'fence.mjs', 'src/main.ts'].filter((f) => !fs.existsSync(path.join(root, f)));
if (missing.length) {
  console.log(`skip: no cage yet (${missing.join(', ')} missing); spec step 3 adds it`);
  process.exit(78);
}
if (!process.allowedNodeEnvironmentFlags.has('--permission-audit')) {
  console.log(`FAIL Node ${process.version} has no --permission-audit; run the witness on Node 24 or later`);
  process.exit(1);
}
const { cage } = await import(pathToFileURL(path.join(root, 'hud.mjs')).href);
const witness = new URL('lib/witness.mjs', import.meta.url).href;

function render(c, dataDir) {
  const { args, env } = cage({ logicDir: path.join(root, 'src'), entry, dataDir });
  if (!args.includes('--permission')) return { records: ['cage() does not pass --permission'] };
  return new Promise((resolve) => {
    const audit = ['--permission-audit', `--import=${witness}`, ...args.filter((a) => a !== '--permission')];
    const child = spawn(process.execPath, audit, { env: { ...env, COLUMNS: String(c.columns), TZ: c.tz ?? 'UTC' } });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    child.stdout.resume();
    child.stdin.end(JSON.stringify({ stdin: c.stdin, facts: c.facts ?? {}, mode: 'render' }));
    const killer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    child.on('close', () => {
      clearTimeout(killer);
      const line = stderr.split('\n').findLast((l) => l.startsWith('WITNESS '));
      resolve({ records: line ? JSON.parse(line.slice(8)) : [`no witness report: ${stderr.slice(0, 300)}`] });
    });
  });
}

const dir = path.join(root, 'tests', 'corpus');
let failed = 0;
let ran = 0;
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const c = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  if (validateCase(c).length || typeof c.stdin !== 'object' || (c.platform && c.platform !== process.platform)) continue;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-witness-'));
  const { records } = await render(c, dataDir);
  fs.rmSync(dataDir, { recursive: true, force: true });
  ran++;
  failed += records.length ? 1 : 0;
  console.log(`${records.length ? 'FAIL' : '  ok'} ${file}${records.map((r) => `\n     outside the grants: ${r}`).join('')}`);
}
console.log(`${ran - failed}/${ran} renders stayed inside the grants`);
process.exitCode = failed || !ran ? 1 : 0;
