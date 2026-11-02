// Every launcher, from ones copied into users' config dirs long ago to the scripts/statusline.mjs
// `hud install` copies today, imports dist/index.js (src/index.ts under Bun) from the newest installed
// version. Those two files are stubs that forward to hud.mjs. This runs that launcher against a fake install of
// this tree on the Node running the check (verify.yml runs it on every Node in its matrix), then on Bun:
//   - a supported Node renders the HUD; an older one prints the one line that ends in /hud;
//   - `hud doctor` answers on any Node, and says when this one is too old;
//   - Bun prints what Node prints, because Bun hands the render to Node.
// Imports nothing that old Node can't load.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const INSTALLED = ['hud.mjs', 'collector.mjs', 'fence.mjs', 'install.mjs', 'package.json', 'dist', 'src'];
const STDIN = JSON.stringify({ model: { display_name: 'Opus' }, context_window: { used_percentage: 45, context_window_size: 200000 } });
const [major, minor] = process.versions.node.split('.').map(Number);
const supported = major > 22 || (major === 22 && minor >= 18);

const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? '  ok' : 'FAIL'} ${name}${ok ? '' : `: ${JSON.stringify(detail).slice(0, 400)}`}`);
};

function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-launcher-'));
  try {
    return fn(home, path.join(home, '.claude'));
  } finally {
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 5 });
  }
}
// This Node first on PATH, so the Node that Bun hands the render to is the one under test.
const envFor = (home, configDir) => ({ PATH: [path.dirname(process.execPath), process.env.PATH].join(path.delimiter), HOME: home, USERPROFILE: home, SystemRoot: process.env.SystemRoot, CLAUDE_CONFIG_DIR: configDir, COLUMNS: '104' });

function render(runtime, args) {
  return withHome((home, configDir) => {
    const version = path.join(configDir, 'plugins', 'cache', 'claude-hud', 'claude-hud', '0.14.2');
    for (const name of INSTALLED) fs.cpSync(path.join(root, name), path.join(version, name), { recursive: true });
    const launcher = path.join(configDir, 'plugins', 'claude-hud', 'statusline.mjs');
    fs.cpSync(path.join(root, 'scripts', 'statusline.mjs'), launcher);
    return spawnSync(runtime, [...args, launcher], { input: STDIN, encoding: 'utf8', env: envFor(home, configDir) });
  });
}

const node = render(process.execPath, []);
if (supported) {
  check(`Node ${process.version}: today's launcher renders two HUD lines through dist/index.js`,
    node.status === 0 && /\[Opus\]/.test(node.stdout) && /45%/.test(node.stdout) && node.stdout.split('\n').length === 3, node);
} else {
  check(`Node ${process.version}: today's launcher prints the upgrade line`,
    node.status === 0 && node.stdout === `claude-hud needs Node 22.18+ (this is ${process.version}). Type /hud to fix it.\n`, node);
}

// /hud runs `node hud.mjs doctor` with whatever node is on PATH, so it must answer on old Node too.
const doctor = withHome((home, configDir) => spawnSync(process.execPath, [path.join(root, 'hud.mjs'), 'doctor'], { encoding: 'utf8', env: envFor(home, configDir) }));
let facts = null;
try {
  facts = JSON.parse(doctor.stdout);
} catch { /* reported below */ }
check(`Node ${process.version}: hud doctor answers`, doctor.status === 0 && facts?.runtime?.version === process.versions.node
  && facts.runtime.supported === supported && (supported || /needs Node 22\.18\+/.test(facts.findings[0])), doctor);

// Older setups launched Bun with --env-file /dev/null.
const bun = render('bun', process.platform === 'win32' ? [] : ['--env-file', '/dev/null']);
check('Bun: the same launcher goes through src/index.ts and prints what Node prints', !bun.error && bun.status === 0 && bun.stdout === node.stdout,
  bun.error ? `no bun: ${bun.error.message}` : bun);

console.log(`${results.every(Boolean) ? '' : 'FAIL '}${results.filter(Boolean).length}/${results.length} launcher checks hold`);
process.exitCode = results.every(Boolean) ? 0 : 1;
