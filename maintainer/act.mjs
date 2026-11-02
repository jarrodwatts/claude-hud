// ACT: the only maintainer code that writes to GitHub. Owner-owned. It holds the App token and treats
// everything the agent or a PR produced as data: nothing from the outbox or a PR is ever executed.
//   node maintainer/act.mjs apply <dir>   carry out <dir>/outbox.json: reply | label | close | propose
//   node maintainer/act.mjs gate          post the required "gate" check for the PR a verify run tested
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

// The agent's paths: logic, its tests, and prose. Everything else holds a capability or decides how one
// loads (workflows, the checks, the owner's code, manifests, git and npm config, and every file Claude
// Code runs from a plugin: hooks, monitors, language servers, skills…), so it needs the owner. Naming
// the agent's side means a kind of plugin file Claude Code learns to run later is the owner's from day one.
// Plain ASCII names matched without case, so no disk that folds case or Unicode turns one into
// src/index.ts, the stub every launcher imports under Bun.
const AGENT = [
  /^src\/(?!index\.ts$)[\w./-]+\.ts$/i,
  /^tests\/[\w./-]+$/i,
  /^(README|README\.zh|CHANGELOG|CLAUDE|ARCHITECTURE|CONTRIBUTING|maintainer\/PLAYBOOK)\.md$/i,
  /^tsconfig\.json$/i,
];
// Fixtures may gain files but never change, lose or rename one.
const APPEND_ONLY = /^tests\/corpus\//i;
// A release moves the version and nothing else, in the files that carry it. That is the agent's call:
// a release publishes main, and everything on main already passed the gate.
const VERSIONED = ['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json', 'package.json', 'package-lock.json'];
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

// Bot text can't link out or ping anyone. Every URL-like run (scheme://, //host or www.) and every link
// target, however relative (`[t](x)`, `[r]: x`, href= or src=), is parsed, and stays only as an https
// page of this repo already in its parsed form, so no `..`, encoding trick or path like /someone/else
// leads elsewhere. @ gets a zero-width space.
const URLISH = /(?:\b[a-z][a-z0-9+.-]*:)?\/\/[^\s<>()[\]"'`]+|\bwww\.[^\s<>()[\]"'`]+|(?<=\]\(\s*<?|^ {0,3}\[[^\]\n]+\]:[ \t]*<?|\b(?:href|src)\s*=\s*["']?)[^\s<>()"'`]+/gim;
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
// The result is what only the owner may merge: a path outside AGENT that isn't a release; a fixture
// changed, lost or renamed (fixtures only grow, unless the owner says a case was wrong); a mode, symlink,
// submodule, type or binary change.
function inspect(base, head) {
  const from = git('merge-base', base, head);
  const show = (ref, path) => git('show', `${ref}:${path}`);
  const version = (ref) => JSON.parse(show(ref, '.claude-plugin/plugin.json')).version;
  // A release: every manifest moves from the old version to a later one together, and nothing else in them changes.
  const isRelease = () => {
    try {
      const [old, next] = [version(from), version(head)];
      return /^\d+\.\d+\.\d+$/.test(next) && next.localeCompare(old, 'en', { numeric: true }) > 0
        && VERSIONED.every((p) => show(head, p) === show(from, p).replaceAll(`"version": "${old}"`, `"version": "${next}"`));
    } catch {
      return false; // a manifest that is missing or doesn't parse is no release
    }
  };
  let release;
  const owner = [];
  const raw = git('diff', '--raw', '--no-renames', '-z', from, head).split('\0');
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const [oldMode, newMode, , , status] = raw[i].slice(1).split(' ');
    const path = raw[i + 1];
    if (APPEND_ONLY.test(path) && status !== 'A') owner.push(`${path}: fixtures only grow`);
    const agents = AGENT.some((p) => p.test(path)) || (VERSIONED.includes(path) && (release ??= isRelease()));
    if (!agents) owner.push(`${path} is owner-owned`);
    const plain = status === 'A' ? newMode === '100644' : status === 'D' || (status === 'M' && oldMode === newMode && !/^1[26]0000$/.test(oldMode));
    if (!plain) owner.push(`${path}: a mode, symlink, submodule or type change`);
  }
  for (const entry of git('diff', '--numstat', '--no-renames', '-z', from, head).split('\0')) {
    if (entry.startsWith('-\t-\t')) owner.push(`${entry.slice(4)}: a binary change`);
  }
  return owner;
}

// Auto-merge lands a PR as soon as main's required checks pass, so it is turned on only while `gate`
// is one of them, pinned to this App. An unpinned `gate` is not enough: any workflow job named gate, a
// fork's included, would satisfy it. Read from GitHub on every propose; unreadable means off.
async function gateRequired() {
  try {
    return (await api('GET', 'rules/branches/main')).some((rule) => rule.type === 'required_status_checks'
      && rule.parameters.required_status_checks.some((c) => c.context === 'gate' && env.ACT_APP_ID && String(c.integration_id) === env.ACT_APP_ID));
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
    const user = a.from_pr && (await api('GET', `pulls/${a.from_pr}`)).user; // re-landed work keeps its author
    const author = user ? ['--author', `${user.login} <${user.id}+${user.login}@users.noreply.github.com>`] : [];
    git('-c', `user.name=${BOT}`, '-c', `user.email=${BOT}@users.noreply.github.com`, 'commit', '--quiet', '--no-verify', ...author, '-m', clean(a.title));
    const owner = inspect('refs/act/main', 'HEAD');
    if (owner.length) throw new Error(`refused: ${owner[0]}`);
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
  let pr;
  for (let page = 1; !pr; page++) {
    const open = await api('GET', `pulls?state=open&per_page=100&page=${page}`);
    pr = open.find((p) => p.head.sha === run.head_sha);
    if (open.length < 100) break;
  }
  if (!pr) return console.log(`no gate: no open PR has head ${run.head_sha}`);
  const fails = [];
  const { jobs } = await api('GET', `actions/runs/${run.id}/jobs?per_page=100`);
  if (!jobs.length) fails.push('verify ran no jobs');
  for (const j of jobs) if (j.conclusion !== 'success') fails.push(`verify job "${j.name}" concluded ${j.conclusion}; only success counts`);
  git('fetch', '--quiet', '--no-tags', REMOTE, '+refs/heads/main:refs/gate/base', `+refs/pull/${pr.number}/head:refs/gate/head`);
  if (git('rev-parse', 'refs/gate/head') !== run.head_sha) fails.push('the PR has moved on since this verify run');
  const owner = inspect('refs/gate/base', 'refs/gate/head');
  if (owner.length && pr.user.login !== OWNER) {
    const reviews = await api('GET', `pulls/${pr.number}/reviews?per_page=100`);
    if (!reviews.some((r) => r.state === 'APPROVED' && r.user.login === OWNER && r.commit_id === run.head_sha))
      fails.push(`only the owner may merge this (${owner.join('; ')}): the owner must approve ${run.head_sha.slice(0, 7)}, then re-run verify`);
  }
  const conclusion = fails.length ? 'failure' : 'success';
  const summary = fails.map((f) => `- ${f}`).join('\n') || 'Every verify job passed, and owner-owned paths and fixtures are untouched or the owner\'s.';
  console.log(`gate ${conclusion} for #${pr.number} at ${run.head_sha}\n${summary}`);
  await api('POST', 'check-runs', { name: 'gate', head_sha: run.head_sha, status: 'completed', conclusion, output: { title: `gate: ${conclusion}`, summary } });
}

const [mode, dir] = process.argv.slice(2);
if (!TOKEN) console.log('ACT is inactive: no App token');
else if (mode === 'gate') await gate();
else if (mode === 'apply') await apply(dir);
else throw new Error('usage: act.mjs apply <dir> | act.mjs gate');
