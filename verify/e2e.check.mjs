// P3: the pinned, checksummed Claude Code, a real terminal, and no network. Installs this checkout
// the way users do (marketplace add, plugin install, `hud install`) from a folder whose path has a
// space, runs everything inside `unshare -rn` against lib/fake-api.mjs on loopback, and checks:
//   - the HUD rows Claude Code draws in a tmux pane, and the installed command's latency;
//   - the /hud skill: doctor is inlined before the model reads a word, the read-only `hud preview`
//     runs unasked, `hud set` needs the user's approval, and with no node the skill still loads.
// Writes screen.ans, screen.html and screen.png to $VERIFY_OUT, and the rows to the job summary.
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { cells, unsafeEscape, visible } from './case.mjs';
import { ans2html } from './lib/ans2html.mjs';
import { CLAUDE_CODE, installClaudeCode } from './lib/claude-code.mjs';
import { startFakeApi } from './lib/fake-api.mjs';

const COLS = 100;
const ROWS = 24;
const checkout = fileURLToPath(new URL('..', import.meta.url));
const run = promisify(execFile);
const t0 = Number(process.env.E2E_T0) || Date.now();
const step = (what) => console.log(`  .. ${((Date.now() - t0) / 1000).toFixed(1)}s ${what}`);

if (process.env.E2E_WORK) await inside(process.env.E2E_WORK);
else await outside();

// Phase 1, with network: fetch Claude Code, then run phase 2 in a namespace with only loopback.
async function outside() {
  const out = process.env.VERIFY_OUT || path.join(os.tmpdir(), 'claude-hud-verify');
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hud-e2e-')));
  fs.mkdirSync(out, { recursive: true });
  installClaudeCode(path.join(work, 'cc'));
  step(`installed Claude Code ${CLAUDE_CODE.version}, checksum ok`);
  try {
    execFileSync('unshare', ['-rn', process.execPath, fileURLToPath(import.meta.url)], { env: { ...process.env, E2E_WORK: work, E2E_T0: String(t0) }, stdio: 'inherit' });
  } catch {
    // Ubuntu 24.04 refuses `unshare -r` until: sysctl kernel.apparmor_restrict_unprivileged_userns=0
    console.log('FAIL the Claude Code sessions did not finish (see above); if unshare was refused, allow user namespaces');
    process.exit(1);
  }
  const r = JSON.parse(fs.readFileSync(path.join(work, 'result.json'), 'utf8'));
  fs.writeFileSync(path.join(out, 'screen.ans'), r.screen);
  fs.writeFileSync(path.join(out, 'screen.html'), ans2html(r.screen, `claude-hud e2e, Claude Code ${CLAUDE_CODE.version}`));
  const png = screenshot(path.join(out, 'screen.html'), path.join(out, 'screen.png'));
  step('screenshot');

  // The HUD is the block under Claude Code's input box: after the last rule, up to the Context row.
  const lines = r.screen.split('\n');
  const rule = lines.findLastIndex((l) => /─{20}/.test(visible(l)));
  const block = lines.slice(rule + 1);
  const rows = block.slice(0, block.findLastIndex((l) => visible(l).includes('Context')) + 1).filter((l) => visible(l).trim());
  const text = rows.map((l) => visible(l).trimEnd());
  const sorted = [...r.ms].sort((a, b) => a - b);
  const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  // tmux re-emits each link with its own id= parameter; the rest must pass hud.mjs's filter unchanged.
  const unsafe = unsafeEscape(rows.join('\n').replace(/\x1b\]8;[^;\x07\x1b]*;/g, '\x1b]8;;')) ?? unsafeEscape(r.raw);
  const checks = [
    ['HUD rows on screen', rows.length >= 2 && /\[.+\]/.test(text[0]) || `found ${rows.length} rows`],
    ['model, project and git on row 1', /\[.+\].*proj.*git:\(main\)/.test(text[0] ?? '') || text[0]],
    ['usage from the API headers reached the HUD', text.some((l) => /Usage .*25%/.test(l)) || 'no Usage 25%'],
    ['no screen row wider than the pane', rows.every((l) => cells(l) <= COLS) || 'too wide'],
    ['no HUD line wider than COLUMNS - 4', r.raw.split('\n').every((l) => cells(l) <= COLS - 4) || `widest ${Math.max(...r.raw.split('\n').map(cells))}`],
    ['only colour and allowed links reach the terminal', !unsafe || unsafe],
    [`render p95 under 300ms (p50 ${p(0.5)}ms, p95 ${p(0.95)}ms)`, p(0.95) < 300 || `p95 ${p(0.95)}ms`],
    ['screen.png written', png || 'no Chrome found; set CHROME'],
    ...r.skill,
  ];
  for (const [name, ok] of checks) console.log(`${ok === true ? '  ok' : 'FAIL'} ${name}${ok === true ? '' : `: ${String(ok).slice(0, 400)}`}`);
  const summary = `### e2e: Claude Code ${CLAUDE_CODE.version}, ${COLS}x${ROWS} tmux, no network\n\n\`\`\`\n${text.join('\n')}\n\`\`\`\n\n`
    + `${checks.map(([name, ok]) => `- ${ok === true ? 'ok' : `**FAIL**: ${String(ok).slice(0, 200)}`}: ${name}`).join('\n')}\n\nScreenshot: \`screen.png\` and \`screen.html\` in the run's artifacts.\n\n`;
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  fs.rmSync(work, { recursive: true, force: true });
  const held = checks.filter(([, ok]) => ok === true).length;
  console.log(`${held === checks.length ? '' : 'FAIL '}${held}/${checks.length} e2e checks hold`);
  process.exitCode = held === checks.length ? 0 : 1;
}

function screenshot(html, png) {
  const shells = [process.env.CHROME, 'google-chrome', 'chromium', 'chromium-browser', 'chrome-headless-shell'].filter(Boolean);
  for (const chrome of shells) {
    try {
      execFileSync(chrome, ['--headless', '--disable-gpu', '--hide-scrollbars', `--screenshot=${png}`, '--window-size=830,430', `file://${html}`], { stdio: 'ignore', timeout: 60_000 });
      return fs.statSync(png).size > 0;
    } catch {}
  }
  return false;
}

// Phase 2, inside `unshare -rn`: loopback is the only network.
async function inside(work) {
  execFileSync('ip', ['link', 'set', 'lo', 'up']);
  const root = path.join(work, 'my plugins', 'claude-hud');
  fs.cpSync(checkout, root, { recursive: true, filter: (from) => !/[\\/](node_modules|\.git)$/.test(from) });
  const claudeDir = path.join(work, 'cc');
  // The fake model asks for one read-only and one writing subcommand once, when /hud has inlined doctor.
  const hud = `node "${root}/hud.mjs"`;
  let asked = false;
  const api = await startFakeApi({
    reply: (body) => {
      if (asked || !JSON.stringify(body.messages).includes('hud doctor')) return null;
      asked = true;
      return [`${hud} preview --width 60`, `${hud} set display.showTools=true`].map((command) => ({ name: 'Bash', input: { command, description: 'hud' } }));
    },
  });

  // A home with the plugin installed the way users install it.
  const home = (name, pathDirs) => {
    const dir = path.join(work, name);
    const proj = path.join(dir, 'proj');
    fs.mkdirSync(proj, { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, projects: { [proj]: { hasTrustDialogAccepted: true } } }));
    const env = {
      HOME: dir, TERM: 'xterm-256color', LANG: 'C.UTF-8', TZ: 'UTC', TMUX_TMPDIR: work, PATH: pathDirs.join(':'),
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${api.port}`, CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-fake-e2e-token',
      DISABLE_AUTOUPDATER: '1', DISABLE_TELEMETRY: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
      GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
      // Plugin install runs `npm ci` in the plugin; offline it fails at once instead of after 60s.
      npm_config_offline: 'true',
    };
    return { dir, proj, env, sh: (cmd, args, extra = {}) => run(cmd, args, { env: { ...env, ...extra }, cwd: proj, timeout: 120_000 }) };
  };
  const user = home('with-node', [claudeDir, path.dirname(process.execPath), '/usr/bin', '/bin']);
  await user.sh('git', ['init', '-q', '-b', 'main']);
  await user.sh('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', 'commit', '-q', '--allow-empty', '-m', 'init']);
  await user.sh('claude', ['plugin', 'marketplace', 'add', root]);
  await user.sh('claude', ['plugin', 'install', 'claude-hud@claude-hud']);
  const cache = path.join(user.dir, '.claude', 'plugins', 'cache', 'claude-hud', 'claude-hud');
  const plugin = path.join(cache, fs.readdirSync(cache)[0]);
  await user.sh(process.execPath, [path.join(plugin, 'hud.mjs'), 'install', '--shell', 'posix']);
  step('installed the plugin and the status line');
  const command = JSON.parse(fs.readFileSync(path.join(user.dir, '.claude', 'settings.json'), 'utf8')).statusLine.command;

  const tmux = (...args) => user.sh('tmux', ['-L', 'e2e', '-f', '/dev/null', ...args]).then((r) => r.stdout);
  const waitFor = async (text) => {
    for (let i = 0; i < 120; i++) {
      if (visible(await tmux('capture-pane', '-p', '-t', 't')).includes(text)) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`timed out waiting for ${JSON.stringify(text)}:\n${await tmux('capture-pane', '-p', '-t', 't')}`);
  };
  let screen;
  try {
    await tmux('new-session', '-d', '-s', 't', '-x', String(COLS), '-y', String(ROWS), '-c', user.proj, 'claude');
    await waitFor('Context');
    step('HUD on screen');
    await tmux('send-keys', '-t', 't', 'say hi', 'Enter');
    await waitFor('mock reply');
    await waitFor('Usage');
    await new Promise((r) => setTimeout(r, 1000));
    step(`reply and usage on screen; the fake API served ${api.requests.length} request(s)`);
    screen = await tmux('capture-pane', '-e', '-p', '-t', 't');
  } finally {
    await tmux('kill-server').catch(() => {});
  }

  // Time the installed statusLine command the way Claude Code runs it: a shell, stdin, COLUMNS.
  const stdin = JSON.stringify({ cwd: user.proj, workspace: { current_dir: user.proj, project_dir: user.proj }, model: { display_name: 'Sonnet 5.5' },
    context_window: { used_percentage: 4, context_window_size: 200000 }, rate_limits: { five_hour: { used_percentage: 25, resets_at: Math.floor(Date.now() / 1000) + 5400 } } });
  // 40 timed runs after 3 untimed ones: with 20, p95 was the single slowest run, so one stall on a
  // shared runner decided the check.
  const ms = [];
  let raw = '';
  for (let i = -3; i < 40; i++) {
    const start = performance.now();
    raw = execFileSync('sh', ['-c', command], { env: { ...user.env, COLUMNS: String(COLS) }, cwd: user.proj, input: stdin, encoding: 'utf8' });
    if (i >= 0) ms.push(Math.round(performance.now() - start));
  }

  // The /hud skill, in `claude -p`.
  const skill = [];
  const prompt = (since) => JSON.stringify(api.requests.slice(since).map((r) => r.messages));
  const toolResult = (since, id) => api.requests.slice(since).flatMap((r) => r.messages).flatMap((m) => (Array.isArray(m.content) ? m.content : []))
    .find((block) => block.type === 'tool_result' && block.tool_use_id.endsWith(id));
  const resultText = (block) => JSON.stringify(block?.content ?? '');
  let since = api.requests.length;
  const asking = await user.sh('claude', ['-p', '/hud is my status line set up?', '--output-format', 'text'], { TERM: 'dumb' }).catch((e) => e);
  const seen = prompt(since);
  skill.push(['/hud runs in claude -p', asking.code === undefined || `exit ${asking.code}: ${asking.stderr}`]);
  skill.push(['/hud inlines doctor, from a plugin path with a space', (seen.includes('\\"supported\\": true') && seen.includes('my plugins') && seen.includes('hud install')) || seen.slice(0, 300)]);
  skill.push(['$ARGUMENTS reaches the prompt', seen.includes('is my status line set up?') || 'not in the prompt']);
  const [preview, set] = ['_0', '_1'].map((id) => toolResult(since, id));
  skill.push(['hud preview is pre-approved and runs', (preview && !preview.is_error && resultText(preview).includes('Preview at 60 columns')) || resultText(preview)]);
  skill.push(['hud set waits for the user\'s approval', (set?.is_error === true && /approval|permission/i.test(resultText(set))) || resultText(set)]);

  // A PATH with Claude Code and a shell, but no node anywhere on it.
  const bare = path.join(work, 'bare-bin');
  fs.mkdirSync(bare);
  for (const tool of ['sh', 'bash']) fs.symlinkSync(fs.realpathSync(`/bin/${tool}`), path.join(bare, tool));
  const noNode = home('no-node', [claudeDir, bare]);
  await noNode.sh('claude', ['plugin', 'marketplace', 'add', root]).catch(() => {});
  await noNode.sh('claude', ['plugin', 'install', 'claude-hud@claude-hud']).catch(() => {});
  since = api.requests.length;
  await noNode.sh('claude', ['-p', '/hud', '--output-format', 'text'], { TERM: 'dumb' }).catch(() => {});
  skill.push(['with no node, the skill loads with the {"runtime":"none"} fallback', prompt(since).includes('{\\"runtime\\":\\"none\\"}') || prompt(since).slice(0, 300)]);
  api.close();
  fs.writeFileSync(path.join(work, 'result.json'), JSON.stringify({ screen, raw, ms, skill }));
}
