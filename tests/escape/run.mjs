// Runs tests/escape/matrix.ts through the real cage: the grants, env and flags hud.mjs uses for a
// render, with a fake home, a fake token, and a local listener that counts connections.
// `node tests/escape/run.mjs` prints Markdown for the CI summary: the matrix, then a control run
// with --permission alone (no fence.mjs), which shows what the fence is there for on this Node.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cageArgs, cageEnv, runCage } from '../../hud.mjs';
import { claudePaths, createProbes, prepareDataDir, readGrants } from '../../collector.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const ENTRY = path.join(root, 'tests', 'escape', 'matrix.ts');
const FAKE_TOKEN = 'sk-ant-fake-token-0000';

// The control: the same flags minus the fence, speaking just enough of the channel for the matrix.
function runWithoutFence({ stdin, dataDir, grants, env }) {
  return new Promise((resolve, reject) => {
    const args = cageArgs({ grants, dataDir, entry: ENTRY }).filter((arg) => !arg.startsWith('--import='));
    const child = spawn(process.execPath, args, { env: cageEnv(env), stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('error', reject);
    child.on('close', () => {
      try {
        resolve(JSON.parse(out.trim().split('\n').at(-1)));
      } catch {
        reject(new Error(`no result: ${out.slice(0, 200)}`));
      }
    });
    child.stdin.end(`${JSON.stringify({ stdin, dataDir, now: Date.now() })}\n`);
  });
}

export async function runMatrix({ fence = true } = {}) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'hud-escape-')));
  let connections = 0;
  const server = createServer((socket) => {
    connections++;
    socket.destroy();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const home = path.join(base, 'home');
    const outside = path.join(base, 'outside');
    const project = path.join(home, 'project');
    for (const dir of [outside, project, path.join(home, '.claude')]) mkdirSync(dir, { recursive: true });
    const secret = path.join(home, '.claude', '.credentials.json');
    writeFileSync(secret, JSON.stringify({ claudeAiOauth: { accessToken: FAKE_TOKEN } }));
    const outsideModule = path.join(outside, 'evil.mjs');
    writeFileSync(outsideModule, 'export default 1;\n');
    const transcript = path.join(home, '.claude', 'projects', 'p', 'session.jsonl');
    mkdirSync(path.dirname(transcript), { recursive: true });
    writeFileSync(transcript, '');

    const env = { HOME: home, USERPROFILE: home, SystemRoot: process.env.SystemRoot, PATH: process.env.PATH,
      ANTHROPIC_API_KEY: FAKE_TOKEN, CLAUDE_CODE_OAUTH_TOKEN: FAKE_TOKEN, GITHUB_TOKEN: FAKE_TOKEN };
    const paths = claudePaths(env, home);
    const dataDir = prepareDataDir(paths);
    const sibling = `${dataDir}-sibling`;
    mkdirSync(sibling);
    const stdin = {
      cwd: project,
      transcript_path: transcript,
      matrix: { home, outside, secret, dataDir, sibling, port: server.address().port, outsideModule: pathToFileURL(outsideModule).href },
    };
    const grants = readGrants({ root, dataDir, paths, stdin });
    const { lines } = fence
      ? await runCage({ stdin, dataDir, grants, env, probes: createProbes({ cwd: project, argv: [], env }), entry: ENTRY })
      : await runWithoutFence({ stdin, dataDir, grants, env });
    return { lines, connections };
  } finally {
    server.close();
    rmSync(base, { recursive: true, force: true, maxRetries: 5 });
  }
}

function report(title, { lines, connections }) {
  const escaped = lines.filter((line) => !line.startsWith('blocked ')).length;
  console.log(`### ${title}, Node ${process.version} on ${process.platform}: ${escaped} of ${lines.length} got through\n`);
  console.log('| Case | Result |\n|---|---|');
  for (const line of lines) {
    const [result, ...rest] = line.split(' ');
    console.log(`| ${rest.join(' ').replaceAll('|', '\\|')} | ${result} |`);
  }
  console.log(`\nConnections reaching the local listener: ${connections}\n`);
  return escaped + connections;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const escapes = report('Escape matrix (the cage hud.mjs runs)', await runMatrix());
  report('Control: --permission without fence.mjs (expected to leak; shows what the fence closes)', await runMatrix({ fence: false }));
  process.exitCode = escapes === 0 ? 0 : 1;
}
