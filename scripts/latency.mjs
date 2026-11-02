// Times full status line renders, the way Claude Code runs them: a fresh process per render with
// the payload on stdin, in a dirty git repo with a real transcript. Prints a Markdown table.
//   node scripts/latency.mjs [runs] [[label=]entry ...]     entries default to hud.mjs
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const runs = Number(process.argv[2]) || 40;
const entries = (process.argv.length > 3 ? process.argv.slice(3) : ['hud.mjs']).map((arg) => {
  const [label, entry] = arg.includes('=') ? arg.split(/=(.*)/s) : [arg, arg];
  return { label, entry: path.resolve(entry) };
});

const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'hud-latency-')));
const home = path.join(base, 'home');
const project = path.join(home, 'project');
const transcript = path.join(home, '.claude', 'projects', 'p', 'session.jsonl');
mkdirSync(project, { recursive: true });
mkdirSync(path.dirname(transcript), { recursive: true });
copyFileSync(path.join(root, 'tests', 'golden', 'transcript.jsonl'), transcript);
const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: project, stdio: 'ignore' });
git('init', '-q', '-b', 'main');
writeFileSync(path.join(project, 'a.txt'), 'one\n');
git('add', '.');
git('commit', '-q', '-m', 'init');
writeFileSync(path.join(project, 'a.txt'), 'one\ntwo\n');

const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, SystemRoot: process.env.SystemRoot, CLAUDE_CONFIG_DIR: path.join(home, '.claude'), COLUMNS: '120' };
const input = JSON.stringify({
  session_id: 'latency', transcript_path: transcript, cwd: project, model: { id: 'claude-opus-5-5', display_name: 'Opus' },
  context_window: { used_percentage: 45, context_window_size: 200_000, current_usage: { input_tokens: 8000, output_tokens: 100 } },
  rate_limits: { five_hour: { used_percentage: 25, resets_at: Math.floor(Date.now() / 1000) + 3600 } },
});

function once(entry) {
  return new Promise((resolve, reject) => {
    const started = process.hrtime.bigint();
    const child = spawn(process.execPath, [entry], { cwd: project, env, stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('error', reject);
    child.on('close', () => (out.includes('Opus') ? resolve(Number(process.hrtime.bigint() - started) / 1e6) : reject(new Error(`no HUD from ${entry}: ${out}`))));
    child.stdin.end(input);
  });
}

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
try {
  console.log(`| Entry | OS | Node | p50 ms | p90 ms | p95 ms | runs |\n|---|---|---|---|---|---|---|`);
  for (const { label, entry } of entries) {
    for (let i = 0; i < 3; i++) await once(entry); // warm the disk cache
    const times = [];
    for (let i = 0; i < runs; i++) times.push(await once(entry));
    times.sort((a, b) => a - b);
    const ms = (p) => percentile(times, p).toFixed(1);
    console.log(`| ${label} | ${process.platform} | ${process.version} | ${ms(50)} | ${ms(90)} | ${ms(95)} | ${runs} |`);
  }
} finally {
  rmSync(base, { recursive: true, force: true, maxRetries: 5 });
}
