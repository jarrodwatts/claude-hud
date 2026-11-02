// P1: the escape matrix. lib/escape-probe.mjs runs as logic through hud.mjs's own runCage, so this
// tests the exact grants, environment, flags and fence users run under, in a fake home holding a
// fake token, next to a local listener that counts connections. Every case must be blocked, and
// the probe's one allowed write must work.
import fs from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runCage } from '../hud.mjs';
import { claudePaths } from '../collector.mjs';

const FAKE_TOKEN = 'sk-ant-fake-token-0000';
const PROBE = fileURLToPath(new URL('lib/escape-probe.mjs', import.meta.url));
const EXPECTED = fs.readFileSync(PROBE, 'utf8').match(/^await check\(/gm).length;
const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hud-escape-')));
let connections = 0;
const server = createServer((socket) => {
  connections++;
  socket.destroy();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

let lines;
let planted;
try {
  const home = path.join(base, 'home');
  const outside = path.join(base, 'outside');
  const project = path.join(home, 'project');
  for (const dir of [outside, project, path.join(home, '.claude')]) fs.mkdirSync(dir, { recursive: true });
  const secret = path.join(home, '.claude', '.credentials.json');
  fs.writeFileSync(secret, JSON.stringify({ claudeAiOauth: { accessToken: FAKE_TOKEN } }));
  const outsideModule = path.join(outside, 'evil.mjs');
  fs.writeFileSync(outsideModule, 'export default 1;\n');
  const transcript = path.join(home, '.claude', 'projects', 'p', 'session.jsonl');
  fs.mkdirSync(path.dirname(transcript), { recursive: true });
  fs.writeFileSync(transcript, '');

  const env = { HOME: home, USERPROFILE: home, SystemRoot: process.env.SystemRoot, PATH: process.env.PATH,
    ANTHROPIC_API_KEY: FAKE_TOKEN, CLAUDE_CODE_OAUTH_TOKEN: FAKE_TOKEN, GITHUB_TOKEN: FAKE_TOKEN };
  const paths = claudePaths(env);
  // What an earlier, hijacked render could have left: a symlink in data/ pointing outside (case 46).
  fs.mkdirSync(paths.dataDir, { recursive: true });
  planted = 'was planted, and the collector swept it before logic ran';
  try {
    fs.symlinkSync(outside, path.join(paths.dataDir, 'planted-link'), 'junction');
  } catch (error) {
    planted = `could not be planted here (${error.code}), so case 46 only shows the write is refused`;
  }
  const sibling = `${fs.realpathSync(paths.dataDir)}-sibling`;
  fs.mkdirSync(sibling);
  const stdin = {
    cwd: project,
    transcript_path: transcript,
    matrix: { home, outside, secret, stripped: paths.strippedDir, sibling, port: server.address().port, outsideModule: pathToFileURL(outsideModule).href },
  };
  ({ lines } = await runCage({ stdin, env, entry: PROBE }));
} finally {
  server.close();
  fs.rmSync(base, { recursive: true, force: true, maxRetries: 5 });
}

const control = lines.pop();
console.log(`  -- the symlink for case 46 ${planted}`);
const cases = lines.filter((line) => line.startsWith('blocked ') || line.startsWith('ESCAPED '));
const escaped = lines.filter((line) => !line.startsWith('blocked '));
for (const line of lines) console.log(`${line.startsWith('blocked ') ? '  ok' : 'FAIL'} ${line}`);
console.log(`${control === 'control wrote inside data/' ? '  ok' : 'FAIL'} ${control}`);
if (connections) console.log(`FAIL the local listener got ${connections} connection(s)`);
const ok = escaped.length === 0 && connections === 0 && cases.length === EXPECTED && control === 'control wrote inside data/';
console.log(`${ok ? '' : 'FAIL '}${cases.length - escaped.length}/${cases.length} escape cases blocked on Node ${process.version} ${process.platform}`);
process.exitCode = ok ? 0 : 1;
