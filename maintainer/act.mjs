// ACT: the only maintainer code that writes to GitHub. Owner-owned. It holds the App token and treats
// everything the agent or a PR produced as data: nothing from the outbox or a PR is ever executed.
//   node maintainer/act.mjs apply <dir>   carry out <dir>/outbox.json: reply | label | close | propose
//   node maintainer/act.mjs gate          post the required "gate" check for the PR a verify run tested
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

// Owner-owned paths: text that holds a capability, or checks one. The agent owns everything else.
const FROZEN = [
  // Directories where any file, old or new, holds a capability: workflows, Claude Code settings and
  // plugin parts (which run or pre-approve tools on users' machines), and the checks.
  '.github/', '.claude/', '.claude-plugin/', 'skills/', 'commands/', 'agents/', 'hooks/', 'verify/',
  // Files that run with full authority on users' machines, or decide what does.
  '.mcp.json', 'hud.mjs', 'collector.mjs', 'fence.mjs', 'install.mjs', 'scripts/statusline.mjs', 'dist/index.js', 'src/index.ts',
  'package.json', 'package-lock.json',
  // The maintainer's own capabilities.
  'maintainer/harness.mjs', 'maintainer/probe.mjs', 'maintainer/scorecard.mjs', 'maintainer/act.mjs', 'maintainer/outbox.schema.json',
];
// Fixtures that may gain files but never change, lose or rename one.
const APPEND_ONLY = ['tests/corpus/', 'redteam/payloads/'];
const CAPS = { reply: 20, label: 20, close: 20, propose: 5 };
const SCHEMA = JSON.parse(fs.readFileSync(new URL('outbox.schema.json', import.meta.url), 'utf8'));

const env = process.env;
const { GITHUB_REPOSITORY: REPO, GITHUB_REPOSITORY_OWNER: OWNER, GH_TOKEN: TOKEN, ACT_BOT: BOT = 'claude-hud-act[bot]' } = env;
const API = env.GITHUB_API_URL ?? 'https://api.github.com';
const SERVER = env.GITHUB_SERVER_URL ?? 'https://github.com';
const REMOTE = `${SERVER}/${REPO}`;
const auth = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${TOKEN}`).toString('base64')}`;
const gitEnv = { ...env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `http.${SERVER}/.extraheader`, GIT_CONFIG_VALUE_0: auth };
const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { encoding: 'utf8', env: gitEnv }).trim();
const under = (list, path) => list.some((p) => (p.endsWith('/') ? path.startsWith(p) : path === p));

async function api(method, path, body) {
  const url = path.startsWith('/') ? API + path : `${API}/repos/${REPO}/${path}`;
  const res = await fetch(url, { method, body: body && JSON.stringify(body), headers: {
    authorization: `Bearer ${TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'claude-hud-act' } });
  const json = res.status === 204 ? null : await res.json();
  if (!res.ok || json?.errors) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

// The subset of JSON Schema that outbox.schema.json uses. Unknown keys are always refused.
function valid(s, v) {
  if ('const' in s) return v === s.const;
  if (s.enum) return s.enum.includes(v);
  if (s.oneOf) return s.oneOf.filter((x) => valid(x, v)).length === 1;
  if (s.type === 'integer') return Number.isInteger(v) && v >= (s.minimum ?? -Infinity);
  if (s.type === 'string') return typeof v === 'string' && v.length <= (s.maxLength ?? Infinity) && (!s.pattern || new RegExp(s.pattern).test(v));
  if (s.type === 'array') return Array.isArray(v) && v.length <= (s.maxItems ?? Infinity) && v.every((x) => valid(s.items, x));
  if (s.type === 'object') return v !== null && typeof v === 'object' && !Array.isArray(v) && (s.required ?? []).every((k) => k in v)
    && Object.entries(v).every(([k, x]) => Object.hasOwn(s.properties, k) && valid(s.properties[k], x));
  return false;
}

// Bot text can't link out or ping anyone. Every URL-like run (scheme://, //host or www.) is parsed, and
// stays only as an https page of this repo already in its parsed form, so no `..` or encoding trick
// leads elsewhere. @ gets a zero-width space.
const URLISH = /(?:\b[a-z][a-z0-9+.-]*:)?\/\/[^\s<>()[\]"'`]+|\bwww\.[^\s<>()[\]"'`]+/gi;
const ownPage = (text) => {
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && url.host === 'github.com' && url.href === text && url.pathname.startsWith(`/${REPO}/`);
  } catch {
    return false;
  }
};
const clean = (s) => s.replace(URLISH, (u) => (ownPage(u) ? u : '[link removed]')).replace(/@(?=[\w-])/g, '@\u200b');

// What a change does, from git's own records of it, never from patch text. propose and the gate both judge with this.
//   never: what nobody may merge (a fixture changed, lost or renamed; fixtures only grow)
//   owner: what only the owner may merge (an owner-owned path; a mode, symlink, submodule, type or binary change)
function inspect(...range) {
  const never = [];
  const owner = [];
  const raw = git('diff', '--raw', '--no-renames', '-z', ...range).split('\0');
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const [oldMode, newMode, , , status] = raw[i].slice(1).split(' ');
    const path = raw[i + 1];
    if (under(APPEND_ONLY, path) && status !== 'A') never.push(`${path}: fixtures are append-only`);
    if (under(FROZEN, path)) owner.push(`${path} is owner-owned`);
    const plain = status === 'A' ? newMode === '100644' : status === 'D' || (status === 'M' && oldMode === newMode && !/^1[26]0000$/.test(oldMode));
    if (!plain) owner.push(`${path}: a mode, symlink, submodule or type change`);
  }
  for (const entry of git('diff', '--numstat', '--no-renames', '-z', ...range).split('\0')) {
    if (entry.startsWith('-\t-\t')) owner.push(`${entry.slice(4)}: a binary change`);
  }
  return { never, owner };
}

// Auto-merge lands a PR as soon as main's required checks pass, so it is turned on only while `gate`
// is one of them, posted by this App or unpinned. Read from GitHub on every propose; unreadable means off.
async function gateRequired() {
  try {
    return (await api('GET', 'rules/branches/main')).some((rule) => rule.type === 'required_status_checks'
      && rule.parameters.required_status_checks.some((c) => c.context === 'gate' && (c.integration_id == null || String(c.integration_id) === env.ACT_APP_ID)));
  } catch {
    return false;
  }
}

const VERBS = {
  reply: (a) => api('POST', `issues/${a.item}/comments`, { body: clean(a.body) }),
  close: (a) => api('PATCH', `issues/${a.item}`, { state: 'closed', state_reason: a.reason }),
  label: (a) => Promise.all([a.add?.length && api('POST', `issues/${a.item}/labels`, { labels: a.add }),
    ...(a.remove ?? []).map((l) => api('DELETE', `issues/${a.item}/labels/${encodeURIComponent(l)}`))]),
  async propose(a, dir) {
    git('fetch', '--quiet', '--no-tags', REMOTE, '+refs/heads/main:refs/act/main');
    git('checkout', '--quiet', '--force', '-B', `bot/${a.slug}`, 'refs/act/main');
    git('apply', '--index', `${dir}/patches/${a.slug}.patch`);
    const { never, owner } = inspect('--cached');
    if (never.length || owner.length) throw new Error(`refused: ${[...never, ...owner][0]}`);
    const user = a.from_pr && (await api('GET', `pulls/${a.from_pr}`)).user; // re-landed work keeps its author
    const author = user ? ['--author', `${user.login} <${user.id}+${user.login}@users.noreply.github.com>`] : [];
    git('-c', `user.name=${BOT}`, '-c', `user.email=${BOT}@users.noreply.github.com`, 'commit', '--quiet', '--no-verify', ...author, '-m', clean(a.title));
    git('push', '--quiet', '--force', REMOTE, `HEAD:refs/heads/bot/${a.slug}`);
    const [open] = await api('GET', `pulls?state=open&head=${OWNER}:bot/${a.slug}`);
    const pr = open ?? (await api('POST', 'pulls', { head: `bot/${a.slug}`, base: 'main', title: clean(a.title), body: clean(a.body) }));
    if (!(await gateRequired())) return console.log(`auto-merge stays off for #${pr.number}: gate is not a required check on main`);
    await api('POST', '/graphql', { variables: { id: pr.node_id }, query:
      'mutation($id: ID!) { enablePullRequestAutoMerge(input: {pullRequestId: $id, mergeMethod: REBASE}) { clientMutationId } }' });
  },
};

async function apply(dir) {
  const outbox = JSON.parse(fs.readFileSync(`${dir}/outbox.json`, 'utf8'));
  if (!valid(SCHEMA, outbox)) throw new Error('the outbox does not match outbox.schema.json, so nothing was done');
  const used = {};
  for (const a of outbox.actions) {
    used[a.do] = (used[a.do] ?? 0) + 1;
    const what = `${a.do} ${a.item ?? a.slug}`;
    if (used[a.do] > CAPS[a.do]) { console.log(`SKIP ${what}: over the cap of ${CAPS[a.do]} per run`); continue; }
    await VERBS[a.do](a, dir).then(() => console.log(`DONE ${what}`), (e) => console.log(`FAIL ${what}: ${e.message}`));
  }
}

// Main's copy runs this after every verify run, and reads the PR only as git data and API records.
async function gate() {
  const run = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8')).workflow_run;
  if (run.path !== '.github/workflows/verify.yml' || run.event !== 'pull_request') return console.log(`no gate: ${run.path} on ${run.event}`);
  const pr = (await api('GET', 'pulls?state=open&per_page=100')).find((p) => p.head.sha === run.head_sha);
  if (!pr) return console.log(`no gate: no open PR has head ${run.head_sha}`);
  const fails = [];
  const { jobs } = await api('GET', `actions/runs/${run.id}/jobs?per_page=100`);
  if (!jobs.length) fails.push('verify ran no jobs');
  for (const j of jobs) if (j.conclusion !== 'success') fails.push(`verify job "${j.name}" concluded ${j.conclusion}; only success counts`);
  git('fetch', '--quiet', '--no-tags', REMOTE, '+refs/heads/main:refs/gate/base', `+refs/pull/${pr.number}/head:refs/gate/head`);
  if (git('rev-parse', 'refs/gate/head') !== run.head_sha) fails.push('the PR has moved on since this verify run');
  const { never, owner } = inspect('refs/gate/base...refs/gate/head');
  fails.push(...never);
  if (owner.length && pr.user.login !== OWNER) {
    const reviews = await api('GET', `pulls/${pr.number}/reviews?per_page=100`);
    if (!reviews.some((r) => r.state === 'APPROVED' && r.user.login === OWNER && r.commit_id === run.head_sha))
      fails.push(`only the owner may merge this (${owner.join('; ')}): the owner must approve ${run.head_sha.slice(0, 7)}, then re-run verify`);
  }
  const conclusion = fails.length ? 'failure' : 'success';
  const summary = fails.map((f) => `- ${f}`).join('\n') || 'Every verify job passed, fixtures only grew, and owner-owned paths are untouched or approved.';
  console.log(`gate ${conclusion} for #${pr.number} at ${run.head_sha}\n${summary}`);
  await api('POST', 'check-runs', { name: 'gate', head_sha: run.head_sha, status: 'completed', conclusion, output: { title: `gate: ${conclusion}`, summary } });
}

const [mode, dir] = process.argv.slice(2);
if (!TOKEN) console.log('ACT is inactive: no App token');
else if (mode === 'gate') await gate();
else if (mode === 'apply') await apply(dir);
else throw new Error('usage: act.mjs apply <dir> | act.mjs gate');
