// P3: real Claude Code, real terminal, no network. Installs this checkout the way users do
// (marketplace add, plugin install, setup), runs pinned Claude Code in tmux inside `unshare -rn`
// against a loopback fake API, sends one message, and checks the HUD rows on the screen.
// Writes screen.ans, screen.html and screen.png to $VERIFY_OUT, and the rows to the job summary.
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { cells, unsafeEscape, visible } from './case.mjs';
import { ans2html } from './lib/ans2html.mjs';
import { startFakeApi } from './lib/fake-api.mjs';

const CLAUDE_CODE = '2.1.310';
const BIN = `claude-code-${process.platform}-${process.arch}`;
const COLS = 100;
const ROWS = 24;
const root = fileURLToPath(new URL('..', import.meta.url));
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
  // The platform package holds the native binary; installing it directly runs no install script.
  execFileSync('npm', ['install', '--prefix', path.join(work, 'cc'), '--ignore-scripts', '--no-audit', '--no-fund', `@anthropic-ai/${BIN}@${CLAUDE_CODE}`], { stdio: 'ignore' });
  step(`installed Claude Code ${CLAUDE_CODE}`);
  try {
    execFileSync('unshare', ['-rn', process.execPath, fileURLToPath(import.meta.url)], { env: { ...process.env, E2E_WORK: work, E2E_T0: String(t0) }, stdio: 'inherit' });
  } catch {
    // Ubuntu 24.04 refuses `unshare -r` until: sysctl kernel.apparmor_restrict_unprivileged_userns=0
    console.log('FAIL the Claude Code session did not finish (see above); if unshare was refused, allow user namespaces');
    process.exit(1);
  }
  const r = JSON.parse(fs.readFileSync(path.join(work, 'result.json'), 'utf8'));
  fs.writeFileSync(path.join(out, 'screen.ans'), r.screen);
  fs.writeFileSync(path.join(out, 'screen.html'), ans2html(r.screen, `claude-hud e2e, Claude Code ${CLAUDE_CODE}`));
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
  const unsafe = unsafeEscape(rows.join('\n')) ?? unsafeEscape(r.raw);
  const checks = [
    ['HUD rows on screen', rows.length >= 2 && /\[.+\]/.test(text[0]) || `found ${rows.length} rows`],
    ['model, project and git on row 1', /\[.+\].*proj.*git:\(main\)/.test(text[0] ?? '') || text[0]],
    ['usage from the API headers reached the HUD', text.some((l) => /Usage .*25%/.test(l)) || 'no Usage 25%'],
    ['no screen row wider than the pane', rows.every((l) => cells(l) <= COLS) || 'too wide'],
    ['no HUD line wider than COLUMNS - 4', r.raw.split('\n').every((l) => cells(l) <= COLS - 4) || `widest ${Math.max(...r.raw.split('\n').map(cells))}`],
    ['only colour and links reach the terminal', !unsafe || unsafe],
    [`render p95 under 300ms (p50 ${p(0.5)}ms, p95 ${p(0.95)}ms)`, p(0.95) < 300 || `p95 ${p(0.95)}ms`],
    ['screen.png written', png || 'no Chrome found; set CHROME'],
  ];
  for (const [name, ok] of checks) console.log(`${ok === true ? '  ok' : 'FAIL'} ${name}${ok === true ? '' : `: ${ok}`}`);
  const summary = `### e2e: Claude Code ${CLAUDE_CODE}, ${COLS}x${ROWS} tmux, no network\n\n\`\`\`\n${text.join('\n')}\n\`\`\`\n\n`
    + `${checks.map(([name, ok]) => `- ${ok === true ? 'ok' : `**FAIL**: ${ok}`}: ${name}`).join('\n')}\n\nScreenshot: \`screen.png\` and \`screen.html\` in the run's artifacts.\n\n`;
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  fs.rmSync(work, { recursive: true, force: true });
  const held = checks.filter(([, ok]) => ok === true).length;
  console.log(`${held}/${checks.length} e2e checks hold`);
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
  const api = await startFakeApi();
  const home = path.join(work, 'home');
  const proj = path.join(home, 'proj');
  fs.mkdirSync(proj, { recursive: true });
  const env = {
    HOME: home, TERM: 'xterm-256color', LANG: 'C.UTF-8', TZ: 'UTC', TMUX_TMPDIR: work,
    PATH: [path.join(work, 'cc', 'node_modules', '@anthropic-ai', BIN), path.dirname(process.execPath), '/usr/bin', '/bin'].join(':'),
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${api.port}`, CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-fake-e2e-token',
    DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    // Plugin install runs `npm ci` in the plugin; offline it fails at once instead of after 60s.
    npm_config_offline: 'true',
  };
  const sh = (cmd, args) => run(cmd, args, { env, cwd: proj });
  await sh('git', ['init', '-q', '-b', 'main']);
  await sh('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', 'commit', '-q', '--allow-empty', '-m', 'init']);
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, projects: { [proj]: { hasTrustDialogAccepted: true } } }));

  // What a user does: add the marketplace, install the plugin, run setup's installer.
  await sh('claude', ['plugin', 'marketplace', 'add', root]);
  await sh('claude', ['plugin', 'install', 'claude-hud@claude-hud']);
  const cache = path.join(home, '.claude', 'plugins', 'cache', 'claude-hud', 'claude-hud');
  const plugin = path.join(cache, fs.readdirSync(cache)[0]);
  const installer = ['install.mjs', 'scripts/setup.mjs'].map((f) => path.join(plugin, f)).find((f) => fs.existsSync(f));
  await sh(process.execPath, [installer, 'install', '--shell', 'posix']);
  step('installed the plugin and the status line');
  const command = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8')).statusLine.command;

  const tmux = (...args) => sh('tmux', ['-L', 'e2e', '-f', '/dev/null', ...args]).then((r) => r.stdout);
  const waitFor = async (text) => {
    for (let i = 0; i < 120; i++) {
      if (visible(await tmux('capture-pane', '-p', '-t', 't')).includes(text)) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`timed out waiting for ${JSON.stringify(text)}:\n${await tmux('capture-pane', '-p', '-t', 't')}`);
  };
  try {
    await tmux('new-session', '-d', '-s', 't', '-x', String(COLS), '-y', String(ROWS), '-c', proj, 'claude');
    await waitFor('Context');
    step('HUD on screen');
    await tmux('send-keys', '-t', 't', 'say hi', 'Enter');
    await waitFor('mock reply');
    await waitFor('Usage');
    await new Promise((r) => setTimeout(r, 1000));
    step(`reply and usage on screen; the fake API served ${api.requests.length} request(s)`);
    const screen = await tmux('capture-pane', '-e', '-p', '-t', 't');

    // Time the installed statusLine command the way Claude Code runs it: a shell, stdin, COLUMNS.
    const stdin = JSON.stringify({ cwd: proj, workspace: { current_dir: proj, project_dir: proj }, model: { display_name: 'Sonnet 5.5' },
      context_window: { used_percentage: 4, context_window_size: 200000 }, rate_limits: { five_hour: { used_percentage: 25, resets_at: Math.floor(Date.now() / 1000) + 5400 } } });
    const ms = [];
    let raw = '';
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      raw = execFileSync('sh', ['-c', command], { env: { ...env, COLUMNS: String(COLS) }, cwd: proj, input: stdin, encoding: 'utf8' });
      ms.push(Math.round(performance.now() - start));
    }
    fs.writeFileSync(path.join(work, 'result.json'), JSON.stringify({ screen, raw, ms }));
  } finally {
    await tmux('kill-server').catch(() => {});
    api.close();
  }
}
