// P2, with the P1 witness: every fixture in tests/corpus keeps its properties. Each case goes the
// way a real render does, through hud.mjs's own readStdin, runCage and terminalFilter, in a scratch
// home that holds only the case. The case's `facts` stand in for the probes, so git, jj and the
// rest replay with no program run. On Node with --permission-audit, the cage runs in audit mode:
// the case's own expect words prove a render happened, and the audit proves it stayed inside the
// grants (enforce mode would hide a denied read as a silently missing segment).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { readStdin, runCage, terminalFilter } from '../hud.mjs';
import { checkExpect, validateCase } from './case.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = path.join(root, 'tests', 'corpus');
const audit = process.allowedNodeEnvironmentFlags.has('--permission-audit');

// The answers a case recorded, for the probes logic asks for. A probe the case has no answer for answers nothing.
const replay = (facts = {}) => async (names) => Object.fromEntries(names.filter((name) => Object.hasOwn(facts, name)).map((name) => [name, facts[name]]));

async function render(c) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hud-case-')));
  try {
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
    const env = { HOME: home, USERPROFILE: home, SystemRoot: process.env.SystemRoot, COLUMNS: String(c.columns), TZ: c.tz ?? 'UTC', LANG: 'en_US.UTF-8' };

    const t0 = performance.now();
    const pipe = new PassThrough();
    pipe.write(input);
    if (!c.stdinOpen) pipe.end();
    const stdin = await readStdin(pipe);
    try {
      const output = await runCage({ stdin, now: c.now ? Date.parse(c.now) : Date.now(), probes: replay(c.facts), env, audit });
      const filter = terminalFilter(stdin);
      return {
        code: output.failed ? 1 : 0,
        out: output.lines.map((line) => `${filter(line)}\n`).join(''),
        raw: output.lines.join('\n'),
        err: output.failed ? output.lines.join('\n') : '',
        ms: Math.round(performance.now() - t0),
        outside: output.outside ?? [],
      };
    } catch (error) {
      return { code: 1, out: '', err: String(error?.message ?? error), ms: Math.round(performance.now() - t0), outside: [] };
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true, maxRetries: 5 });
  }
}

let failed = 0;
let ran = 0;
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
for (const file of files) {
  let c;
  try {
    c = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  } catch (e) {
    c = e;
  }
  const errors = c instanceof Error ? [c.message] : validateCase(c);
  if (errors.length) {
    failed++;
    console.log(`FAIL ${file}: ${errors.join('; ')}`);
    continue;
  }
  if (c.platform && c.platform !== process.platform) {
    console.log(`  -- ${file}: ${c.platform} only`);
    continue;
  }
  ran++;
  const r = await render(c);
  const misses = c.expect.map((w) => [w, checkExpect(w, r, c)]).filter(([, res]) => res !== true);
  misses.push(...r.outside.map((access) => ['inside the grants', `logic reached ${access}`]));
  failed += misses.length ? 1 : 0;
  console.log(`${misses.length ? 'FAIL' : '  ok'} ${file} (${r.ms}ms)${misses.map(([w, res]) => `\n     ${w}: ${res}`).join('')}`);
}
const mode = audit ? 'audited: every access inside the grants' : 'enforced (this Node has no --permission-audit)';
console.log(`${failed || !ran ? 'FAIL ' : ''}${files.length - failed}/${files.length} cases hold on Node ${process.version} ${process.platform}, ${mode}`);
process.exitCode = failed || !ran ? 1 : 0;
