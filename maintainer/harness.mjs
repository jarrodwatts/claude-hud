// The maintainer harness (owner-owned). It runs on a fresh GitHub VM as `runner`, which has passwordless sudo.
// It builds the inbox, keeps the subscription token inside the relay, jails Claude as the unix user `agent`
// (no sudo, network = the relay only), proves the jail with the reach probe, and collects what Claude left as plain data.
//   RELAY_TOKEN=<subscription token> node maintainer/harness.mjs <out dir>
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { scorecard } from './scorecard.mjs';
import { installClaudeCode } from '../verify/lib/claude-code.mjs';

const MODEL = 'claude-opus-5-5';
const TOOLS = 'Bash,Read,Edit,Write,Glob,Grep,Task';
const JAIL = '/tmp/maint';
const PORT = 8642; // the relay, and the only place `agent` may connect to
const env = process.env;
const TOKEN = env.RELAY_TOKEN;
delete env.RELAY_TOKEN;
const UPSTREAM = new URL(env.RELAY_UPSTREAM ?? 'https://api.anthropic.com');
const BUDGET = Number(env.RELAY_BUDGET ?? 3e6); // input + cache-write + output tokens per run
const DAILY_BUDGET = Number(env.RELAY_DAILY_BUDGET ?? 4 * BUDGET); // across every run in the last 24 hours
const AGENT_EVENTS = ['issues', 'issue_comment', 'schedule', 'workflow_dispatch']; // the agent job's events; maintain.yml names them twice more, and the maintainer check holds all three equal
const [outDir] = process.argv.slice(2);
const sh = (cmd, ...args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
const agent = (...args) => ['-u', 'agent', 'env', '-i', '-C', `${JAIL}/repo`, 'HOME=/home/agent',
  `PATH=${path.dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`, ...args];
const run = (args, ms) => new Promise((done) => { // async, so the relay in this process keeps serving
  const p = spawn('sudo', args, { stdio: ['ignore', 'pipe', 'inherit'] });
  const timer = ms && setTimeout(() => spawn('sudo', ['pkill', '-KILL', '-u', 'agent']), ms);
  let out = '';
  p.stdout.on('data', (c) => (out += c));
  p.on('close', (code) => { clearTimeout(timer); done({ code, out }); });
});
const gh = async (p) => {
  const r = await fetch(`${env.GITHUB_API_URL ?? 'https://api.github.com'}/repos/${env.GITHUB_REPOSITORY}/${p}`, { headers: { authorization: `Bearer ${env.GITHUB_TOKEN}` } });
  if (!r.ok) throw new Error(`GET ${p}: ${r.status}`);
  return p.includes('/logs') ? (await r.text()).slice(-3000) : r.json();
};

if (!TOKEN) { console.log('maintainer inactive: no RELAY_TOKEN'); process.exit(0); }

// 0. The daily cap. Each agent run of the last 24 hours counts what its relay recorded (the artifact
//    relay-tokens-<n>), or its whole per-run budget if it recorded nothing, since it may have died
//    mid-spend. Anything unreadable throws, so no run starts: the cap fails closed.
const dayAgo = new Date(Date.now() - 864e5);
const recent = [];
for (const event of AGENT_EVENTS) {
  for (let page = 1; ; page++) {
    const { workflow_runs: runs } = await gh(`actions/workflows/maintain.yml/runs?event=${event}&created=>=${dayAgo.toISOString().slice(0, 10)}&per_page=100&page=${page}`);
    recent.push(...runs.filter((r) => r.event === event && new Date(r.created_at) > dayAgo && r.id !== Number(env.GITHUB_RUN_ID)));
    if (runs.length < 100) break;
    if (page === 5) throw new Error(`over 500 ${event} runs in two days: not starting`);
  }
}
let spentToday = 0;
for (const r of recent) {
  const recorded = (await gh(`actions/runs/${r.id}/artifacts`)).artifacts.map((a) => /^relay-tokens-(\d+)$/.exec(a.name)?.[1]).find(Boolean);
  if (recorded) spentToday += Number(recorded);
  else if ((await gh(`actions/runs/${r.id}/jobs`)).jobs.some((j) => j.name === 'agent' && j.conclusion !== 'skipped' && j.steps?.length)) spentToday += BUDGET;
}
const budget = Math.min(BUDGET, DAILY_BUDGET - spentToday);
console.log(`relay: ${spentToday} of the daily ${DAILY_BUDGET} tokens spent in the last 24 hours; this run may spend ${Math.max(0, budget)}`);
if (budget <= 0) { // records a spend of 0, so this run doesn't count against the next day's cap
  console.log('maintainer paused: the daily token cap is spent');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(`${outDir}/relay.json`, JSON.stringify({ model: MODEL, budget: 0, spent: 0 }));
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, 'tokens=0\noutbox=no\n');
  process.exit(0);
}

// 1. The inbox, read with the job's read-only token, plus the frozen scorecard.
const since = new Date(Date.now() - 14 * 864e5).toISOString();
const [items, comments, failed] = await Promise.all([gh(`issues?state=all&since=${since}&per_page=100`),
  gh(`issues/comments?since=${since}&per_page=100`), gh('actions/runs?status=failure&per_page=20')]);
const cut = (s) => (s ?? '').slice(0, 4000);
const ci = await Promise.all(failed.workflow_runs.filter((r) => r.head_branch.startsWith('bot/')).slice(0, 5).map(async (r) => ({
  workflow: r.name, branch: r.head_branch, sha: r.head_sha, failed_jobs: await Promise.all((await gh(`actions/runs/${r.id}/jobs`)).jobs
    .filter((j) => j.conclusion === 'failure').map(async (j) => ({ name: j.name, log_tail: await gh(`actions/jobs/${j.id}/logs`) }))) })));
const inbox = { repo: env.GITHUB_REPOSITORY, now: new Date().toISOString(), scorecard: await scorecard(gh), ci, items: items.map((i) => ({
  number: i.number, kind: i.pull_request ? 'pr' : 'issue', state: i.state, title: i.title, body: cut(i.body), author: i.user.login,
  role: i.author_association, labels: i.labels.map((l) => l.name), updated: i.updated_at, comments: comments.filter((c) => c.issue_url === i.url)
    .map((c) => ({ author: c.user.login, role: c.author_association, at: c.created_at, body: cut(c.body) })) })) };

// 2. The relay: the only holder of the token. Only POST /v1/messages, model pinned, 400 once the budget is spent
//    (Claude retries a 429 for minutes but stops on a 400). Usage is only known once a reply ends, so each
//    request first reserves the most it could cost, its prompt (a token is never shorter than a byte) plus
//    its max_tokens, and is refused if that doesn't fit: requests sent at once can't overrun the budget
//    together. A reply whose usage it can't read spends the whole budget: accounting that can't count
//    must not keep spending.
let spent = 0;
let reserved = 0;
const usage = (text) => ['input_tokens', 'cache_creation_input_tokens', 'output_tokens']
  .reduce((sum, k) => sum + Math.max(0, ...[...text.matchAll(new RegExp(`"${k}":(\\d+)`, 'g'))].map((m) => Number(m[1]))), 0);
const placeholder = `relay-${crypto.randomUUID()}`;
const relay = http.createServer((req, res) => {
  const deny = (why) => { console.log(`relay: refused ${req.method} ${req.url}: ${why}`); if (res.headersSent) return res.destroy();
    res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: `relay: ${why}` } })); };
  if (req.headers.authorization !== `Bearer ${placeholder}`) return deny('wrong placeholder');
  if (req.method !== 'POST' || !/^\/v1\/messages(\/count_tokens)?(\?beta=true)?$/.test(req.url)) return deny('only POST /v1/messages');
  if (spent >= budget) return deny(`run budget of ${budget} tokens spent`);
  let body = '';
  req.on('data', (c) => (body += c)).on('end', () => {
    let request; try { request = JSON.parse(body); } catch { return deny('body is not JSON'); }
    const out = JSON.stringify({ ...request, model: MODEL });
    const most = Buffer.byteLength(out) + (Number.isSafeInteger(request.max_tokens) && request.max_tokens > 0 ? request.max_tokens : budget);
    if (spent + reserved + most > budget) return deny(`run budget of ${budget} tokens: ${spent} spent and ${reserved} held by requests in flight, so this one, which could cost ${most}, can't start`);
    reserved += most;
    let held = most;
    const release = () => { reserved -= held; held = 0; };
    const { 'accept-encoding': _, 'x-api-key': __, ...headers } = req.headers; // plain text back, so usage can be counted
    const up = (UPSTREAM.protocol === 'https:' ? https : http).request(new URL(req.url, UPSTREAM), { method: 'POST',
      headers: { ...headers, host: UPSTREAM.host, authorization: `Bearer ${TOKEN}`, 'content-length': Buffer.byteLength(out) } }, (r) => {
      let text = '';
      res.writeHead(r.statusCode, r.headers);
      r.on('data', (c) => { text += c; res.write(c); }).on('end', () => {
        res.end();
        release();
        const counted = usage(text);
        if (r.statusCode === 200 && counted === 0) console.log(`relay: no usage readable in the reply to ${req.url}; counting the whole budget`);
        spent = r.statusCode === 200 && counted === 0 ? budget : spent + counted;
        console.log(`relay: ${req.url} ${r.statusCode}, ${spent}/${budget} tokens`);
      });
    });
    up.on('error', (e) => { release(); deny(`upstream ${e.code}`); }).end(out);
  });
});
await new Promise((ok) => relay.listen(PORT, '127.0.0.1', ok));

// 3. The jail: user `agent` may connect to the relay and nothing else, the runner's home closed, a fresh clone, and a canary to catch leaks.
sh('sudo', 'install', '-m', '755', installClaudeCode('/tmp/claude-code'), '/usr/local/bin/claude'); // pinned, checksum checked
if (!fs.existsSync('/home/agent')) {
  sh('sudo', 'useradd', '--create-home', 'agent');
  sh('sudo', 'iptables', '-A', 'OUTPUT', '-m', 'owner', '--uid-owner', 'agent', '-d', '127.0.0.1', '-p', 'tcp', '--dport', String(PORT), '-j', 'ACCEPT');
  for (const t of ['iptables', 'ip6tables']) sh('sudo', t, '-A', 'OUTPUT', '-m', 'owner', '--uid-owner', 'agent', '-j', 'REJECT');
}
sh('sudo', 'chmod', '700', env.HOME); // holds the workspace, step scripts and the runner itself
sh('sudo', 'rm', '-rf', JAIL);
fs.mkdirSync(JAIL, { mode: 0o711 });
fs.mkdirSync(`${JAIL}/out`);
sh('git', 'clone', '--quiet', '--no-hardlinks', process.cwd(), `${JAIL}/repo`);
const prs = items.filter((i) => i.pull_request && i.state === 'open').map((i) => `+refs/pull/${i.number}/head:refs/remotes/pr/${i.number}`);
if (prs.length) sh('git', '-C', `${JAIL}/repo`, 'fetch', '--quiet', `https://github.com/${env.GITHUB_REPOSITORY}`, ...prs);
execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: `${JAIL}/repo`, stdio: 'ignore' }); // the agent has no network
fs.writeFileSync(`${JAIL}/inbox.json`, JSON.stringify(inbox, null, 1));
fs.copyFileSync(new URL('probe.mjs', import.meta.url), `${JAIL}/probe.mjs`);
sh('sudo', 'chown', '-R', 'agent:agent', `${JAIL}/repo`, `${JAIL}/out`);
const canary = `ghp_${crypto.randomBytes(18).toString('hex')}`;
execFileSync('sudo', ['-u', 'agent', 'sh', '-c', 'mkdir -p /home/agent/.config/gh && cat > /home/agent/.config/gh/hosts.yml'], { input: `github.com:\n  oauth_token: ${canary}\n` });

// 4. The reach probe, as `agent`. Anything reachable aborts the run.
const probe = await run(agent('node', `${JAIL}/probe.mjs`, String(PORT), placeholder, String(process.pid), env.HOME, env.RUNNER_TEMP), 120e3);
console.log(probe.out);
if (probe.code !== 0) throw new Error('the reach probe found a way out of the jail: run aborted');

// 5. Claude, as `agent`. It acts only through its final answer, which must match the outbox schema.
const prompt = `You maintain this repository. Read maintainer/PLAYBOOK.md first and follow it. ${JAIL}/inbox.json holds the GitHub state;
open PRs are fetched as refs/remotes/pr/<number>. You have no network and no GitHub access: you act only through your final answer.
To propose a change, save \`git diff\` against main to ${JAIL}/out/<slug>.patch and add a propose action with that slug.`;
const claude = await run(agent(`ANTHROPIC_BASE_URL=http://127.0.0.1:${PORT}`, `CLAUDE_CODE_OAUTH_TOKEN=${placeholder}`, `GH_TOKEN=${canary}`,
  'DISABLE_AUTOUPDATER=1', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1', 'CLAUDE_CODE_DISABLE_AUTO_MEMORY=1',
  'claude', '-p', prompt, '--model', MODEL, '--output-format', 'json', '--no-session-persistence',
  '--json-schema', fs.readFileSync(new URL('outbox.schema.json', import.meta.url), 'utf8'),
  '--restricted', '--add-dir', JAIL, '--tools', TOOLS, '--allowedTools', TOOLS, '--permission-mode', 'dontAsk', '--permission-prompts', 'none'), 45 * 6e4);

// 6. Collect: kill everything `agent` left running, then keep only regular files it owns, under size caps, free of the canary.
await run(['pkill', '-KILL', '-u', 'agent']);
relay.close();
const result = (() => { try { return JSON.parse(claude.out); } catch { return {}; } })();
console.log(`claude exit ${claude.code}: ${result.is_error ? result.result : (result.subtype ?? 'no result')}; relay spent ${spent} tokens`);
const files = { 'relay.json': JSON.stringify({ model: MODEL, budget, spent }) };
if (result.structured_output) files['outbox.json'] = JSON.stringify(result.structured_output, null, 1);
const uid = Number(sh('id', '-u', 'agent'));
for (const name of fs.readdirSync(`${JAIL}/out`)) {
  const st = fs.lstatSync(`${JAIL}/out/${name}`);
  if (/^[a-z0-9-]{3,40}\.patch$/.test(name) && st.isFile() && st.uid === uid && st.size < 256e3) files[`patches/${name}`] = fs.readFileSync(`${JAIL}/out/${name}`, 'utf8');
  else console.log(`ignored out/${name}`);
}
const leaks = [canary, Buffer.from(canary).toString('base64'), Buffer.from(canary).toString('hex'), [...canary].reverse().join('')];
if (Object.values(files).some((text) => leaks.some((l) => text.includes(l)))) throw new Error('the canary left the jail: run aborted');
fs.mkdirSync(`${outDir}/patches`, { recursive: true });
for (const [name, text] of Object.entries(files)) fs.writeFileSync(`${outDir}/${name}`, text);
if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `tokens=${spent}\noutbox=${files['outbox.json'] ? 'yes' : 'no'}\n`);
