// The /hud skill in real Claude Code, against a fake Messages API on loopback, in a throwaway home
// with a fake key. It checks what reached the model and what the permission system did:
//   1. `/hud` inlines `hud doctor` before the model reads a word;
//   2. the read-only `hud preview` runs without asking, and `hud set` needs the user's approval;
//   3. with no node on PATH, the skill still loads, with the {"runtime":"none"} fallback.
// The plugin is installed from a folder whose path has a space, as many Windows homes do.
// Run by CI's `skill` job (it downloads Claude Code): node tests/skill-e2e.mjs
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLAUDE_CODE = '2.1.310';
const checkout = fileURLToPath(new URL('..', import.meta.url));
const work = realpathSync(mkdtempSync(path.join(tmpdir(), 'hud-skill-')));
const root = path.join(work, 'my plugins', 'claude-hud');
cpSync(checkout, root, { recursive: true, filter: (from) => !/[\\/](node_modules|\.git)$/.test(from) });
const pkg = `claude-code-${process.platform}-${process.arch}`;
// CLAUDE_BIN skips the download for a local run. The platform package holds the native binary;
// installing it directly runs no install script.
if (!process.env.CLAUDE_BIN) {
  execFileSync('npm', ['install', '--prefix', path.join(work, 'cc'), '--ignore-scripts', '--no-audit', '--no-fund', `@anthropic-ai/${pkg}@${CLAUDE_CODE}`], { stdio: 'ignore' });
}
const claudeBin = process.env.CLAUDE_BIN || path.join(work, 'cc', 'node_modules', '@anthropic-ai', pkg, 'claude');

// The fake model asks for one read-only and one writing subcommand once, then just answers.
const hud = `node "${root}/hud.mjs"`;
const requests = [];
let askedForTools = false;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    const json = (status, value) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
    if (!req.url.startsWith('/v1/messages')) return json(404, { type: 'error', error: { type: 'not_found_error', message: 'fake' } });
    if (req.url.startsWith('/v1/messages/count_tokens')) return json(200, { input_tokens: 42 });
    const parsed = JSON.parse(body);
    requests.push(parsed);
    const message = { id: 'msg_fake', type: 'message', role: 'assistant', model: parsed.model, content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 3 } };
    if (!parsed.stream) return json(200, { ...message, content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' });
    const events = [['message_start', { message }]];
    if (!askedForTools && JSON.stringify(parsed.messages).includes('hud doctor')) {
      askedForTools = true;
      [`${hud} preview --width 60`, `${hud} set display.showTools=true`].forEach((command, index) => {
        events.push(['content_block_start', { index, content_block: { type: 'tool_use', id: `toolu_${index}`, name: 'Bash', input: {} } }],
          ['content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ command, description: 'hud' }) } }],
          ['content_block_stop', { index }]);
      });
      events.push(['message_delta', { delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 3 } }]);
    } else {
      events.push(['content_block_start', { index: 0, content_block: { type: 'text', text: '' } }],
        ['content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'done' } }], ['content_block_stop', { index: 0 }],
        ['message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } }]);
    }
    events.push(['message_stop', {}]);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const [type, data] of events) res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    res.end();
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

function session(name, pathDirs) {
  const home = path.join(work, name);
  const configDir = path.join(home, '.claude');
  const project = path.join(home, 'project');
  mkdirSync(project, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  writeFileSync(path.join(configDir, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, projects: { [project]: { hasTrustDialogAccepted: true } } }));
  const env = {
    PATH: pathDirs.join(path.delimiter), HOME: home, CLAUDE_CONFIG_DIR: configDir, ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    ANTHROPIC_API_KEY: 'sk-ant-fake-0000', DISABLE_TELEMETRY: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1',
    // Plugin install runs `npm ci` in the plugin; offline it fails at once instead of after 60s.
    npm_config_offline: 'true', TERM: 'dumb',
  };
  // Async: the fake API lives in this process, so a blocking spawn would starve it.
  const claude = (args) => new Promise((resolve) => {
    const child = spawn(claudeBin, args, { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (out += chunk));
    const timer = setTimeout(() => child.kill('SIGKILL'), 90_000);
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, out });
    });
  });
  return claude;
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : `: ${String(detail).slice(0, 400)}`}`);
};
const toolResults = (since) => requests.slice(since).flatMap((r) => r.messages).flatMap((m) => (Array.isArray(m.content) ? m.content : []))
  .filter((block) => block.type === 'tool_result');
const resultText = (block) => JSON.stringify(block?.content ?? '');

try {
  const nodeDir = path.dirname(process.execPath);
  const withNode = session('with-node', [path.dirname(claudeBin), nodeDir, '/usr/bin', '/bin']);
  for (const args of [['plugin', 'marketplace', 'add', root], ['plugin', 'install', 'claude-hud@claude-hud']]) {
    const r = await withNode(args);
    check(`claude ${args.slice(0, 2).join(' ')}`, r.status === 0, r.out);
  }
  let since = requests.length;
  const run = await withNode(['-p', '/hud is my status line set up?', '--output-format', 'text']);
  const prompt = JSON.stringify(requests.slice(since).map((r) => r.messages));
  check('/hud runs in claude -p', run.status === 0, run.out);
  check('doctor facts are inlined, from a plugin path with a space', prompt.includes('\\"supported\\": true') && prompt.includes('my plugins') && prompt.includes('hud install'), prompt.slice(0, 400));
  check('$ARGUMENTS reaches the prompt', prompt.includes('is my status line set up?'));
  const [preview, set] = ['toolu_0', 'toolu_1'].map((id) => toolResults(since).find((block) => block.tool_use_id === id));
  check('hud preview is pre-approved and runs', preview && !preview.is_error && resultText(preview).includes('Preview at 60 columns'), resultText(preview));
  check('hud set is not pre-approved', set?.is_error === true && /approval|permission/i.test(resultText(set)), resultText(set));

  // A PATH with Claude Code and the shell's tools, but no node.
  const bare = path.join(work, 'bare-bin');
  mkdirSync(bare);
  const noNodeDirs = [path.dirname(claudeBin), bare];
  const hasNode = noNodeDirs.some((dir) => existsSync(path.join(dir, 'node')));
  const noNode = session('no-node', [...noNodeDirs, '/bin']);
  await noNode(['plugin', 'marketplace', 'add', root]);
  await noNode(['plugin', 'install', 'claude-hud@claude-hud']);
  since = requests.length;
  await noNode(['-p', '/hud', '--output-format', 'text']);
  const bareShell = spawnShell(['-c', 'command -v node'], [...noNodeDirs, '/bin']);
  const noNodePrompt = JSON.stringify(requests.slice(since).map((r) => r.messages));
  if (hasNode || bareShell) console.log(`SKIP no-node fallback: node is reachable on this runner's /bin (${bareShell})`);
  else check('with no node, the skill loads with the runtime:none fallback', noNodePrompt.includes('{\\"runtime\\":\\"none\\"}'), noNodePrompt.slice(0, 400));
} finally {
  server.close();
  rmSync(work, { recursive: true, force: true, maxRetries: 5 });
}

function spawnShell(args, dirs) {
  try {
    return execFileSync('/bin/sh', args, { env: { PATH: dirs.join(path.delimiter) }, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

process.exitCode = results.every(Boolean) ? 0 : 1;
