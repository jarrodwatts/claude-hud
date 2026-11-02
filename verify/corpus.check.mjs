// P2: every fixture in tests/corpus keeps its properties. Each case renders the HUD the way the
// launcher on users' machines does (`dist/index.js`), in a scratch home that holds only the case.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkExpect, validateCase } from './case.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = path.join(root, 'tests', 'corpus');
const entry = path.join(root, 'dist', 'index.js');

async function render(c) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hud-case-')));
  const home = path.join(base, 'home');
  const cwd = typeof c.stdin === 'object' ? c.stdin.cwd ?? c.stdin.workspace?.current_dir : undefined;
  const project = path.join(home, cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() : 'project');
  fs.mkdirSync(project, { recursive: true });
  if (c.config) {
    fs.mkdirSync(path.join(home, '.claude', 'plugins', 'claude-hud'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'plugins', 'claude-hud', 'config.json'), JSON.stringify(c.config));
  }
  // The reported cwd becomes a real folder with the same name.
  const quoted = (s) => JSON.stringify(s).slice(1, -1);
  const input = typeof c.stdin === 'string' ? c.stdin
    : cwd ? JSON.stringify(c.stdin).replaceAll(quoted(cwd), quoted(project)) : JSON.stringify({ ...c.stdin, cwd: project });
  const env = {
    PATH: process.env.PATH, HOME: home, USERPROFILE: home, SystemRoot: process.env.SystemRoot,
    COLUMNS: String(c.columns), TZ: c.tz ?? 'UTC', LANG: 'en_US.UTF-8',
    GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1',
    ...(c.now ? { VERIFY_NOW: String(Date.parse(c.now)) } : {}),
  };
  const flags = c.now ? ['--import', new URL('lib/clock.mjs', import.meta.url).href] : [];
  const t0 = Date.now();
  const child = spawn(process.execPath, [...flags, entry], { cwd: project, env });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (err += d));
  child.stdin.on('error', () => {});
  child.stdin.write(input);
  if (!c.stdinOpen) child.stdin.end();
  const killer = setTimeout(() => child.kill('SIGKILL'), 5000);
  const code = await new Promise((resolve) => child.on('close', resolve));
  const ms = Date.now() - t0;
  clearTimeout(killer);
  child.stdin.destroy();
  fs.rmSync(base, { recursive: true, force: true });
  return { code, out, err, ms };
}

let failed = 0;
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
for (const file of files) {
  let c;
  try {
    c = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  } catch (e) {
    c = e;
  }
  const errors = c instanceof Error ? [c.message] : validateCase(c);
  if (!errors.length && c.facts && Object.keys(c.facts).length) errors.push('facts need the cage runner (spec step 3)');
  if (errors.length) {
    failed++;
    console.log(`FAIL ${file}: ${errors.join('; ')}`);
    continue;
  }
  if (c.platform && c.platform !== process.platform) {
    console.log(`  -- ${file}: ${c.platform} only`);
    continue;
  }
  const r = await render(c);
  const misses = c.expect.map((w) => [w, checkExpect(w, r, c)]).filter(([, res]) => res !== true);
  failed += misses.length ? 1 : 0;
  console.log(`${misses.length ? 'FAIL' : '  ok'} ${file} (${r.ms}ms)${misses.map(([w, res]) => `\n     ${w}: ${res}`).join('')}`);
}
console.log(`${files.length - failed}/${files.length} cases hold`);
if (!files.length) console.log('FAIL no cases in tests/corpus');
process.exitCode = failed || !files.length ? 1 : 0;
