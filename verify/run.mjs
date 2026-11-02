// Runs every verify/*.check.mjs as its own process, so a new check needs no workflow edit.
// A check exits 0 to pass and anything else to fail. Nothing is skipped: a check that can't run here fails.
//   node verify/run.mjs               every check
//   node verify/run.mjs corpus arch   only these
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const all = fs.readdirSync(dir).filter((f) => f.endsWith('.check.mjs')).map((f) => f.slice(0, -'.check.mjs'.length)).sort();
const wanted = process.argv.slice(2);
const unknown = wanted.filter((name) => !all.includes(name));
if (unknown.length) {
  console.error(`no such check: ${unknown.join(', ')} (have: ${all.join(', ')})`);
  process.exit(1);
}

const rows = [];
for (const name of wanted.length ? wanted : all) {
  console.log(`\n=== ${name}`);
  const t0 = Date.now();
  const child = spawn(process.execPath, ['--no-warnings', path.join(dir, `${name}.check.mjs`)], { stdio: ['ignore', 'pipe', 'inherit'] });
  let tail = '';
  child.stdout.on('data', (d) => {
    process.stdout.write(d);
    tail = (tail + d).slice(-2000);
  });
  const killer = setTimeout(() => child.kill('SIGKILL'), 10 * 60_000);
  const code = await new Promise((resolve) => child.on('close', (c, signal) => resolve(signal ? 1 : c)));
  clearTimeout(killer);
  const result = code === 0 ? 'pass' : 'FAIL';
  const last = tail.trimEnd().split('\n').pop();
  rows.push(`| ${name} | ${result} | ${((Date.now() - t0) / 1000).toFixed(1)}s | ${last.replace(/\|/g, '\\|').slice(0, 200)} |`);
}

const table = ['| check | result | time | last line |', '|---|---|---|---|', ...rows].join('\n');
console.log(`\n${table}`);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## verify (Node ${process.version}, ${process.platform})\n\n${table}\n\n`);
process.exitCode = rows.some((r) => r.includes('| FAIL |')) || !rows.length ? 1 : 0;
