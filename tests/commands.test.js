// The /hud skill's subcommands, run the way the skill runs them: `node hud.mjs <command>` in a
// fake home, after a real render has left its heartbeat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configKeys } from '../src/config.ts';
import { DESCRIPTIONS } from '../src/schema.ts';
import { mask, scrubStdin } from '../src/commands.ts';

const hud = fileURLToPath(new URL('../hud.mjs', import.meta.url));

function withHome(fn) {
  const home = realpathSync(mkdtempSync(path.join(tmpdir(), 'hud-commands-')));
  const configDir = path.join(home, '.claude');
  const project = path.join(home, 'secret-project');
  mkdirSync(project, { recursive: true });
  const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, SystemRoot: process.env.SystemRoot, CLAUDE_CONFIG_DIR: configDir, TZ: 'UTC' };
  const run = (args, { input, columns } = {}) => spawnSync(process.execPath, [hud, ...args], {
    cwd: project, input, encoding: 'utf8', env: { ...env, ...(columns ? { COLUMNS: String(columns) } : {}) },
  });
  const configPath = path.join(configDir, 'plugins', 'claude-hud', 'config.json');
  try {
    return fn({ home, configDir, project, run, configPath });
  } finally {
    rmSync(home, { recursive: true, force: true, maxRetries: 5 });
  }
}

const payload = (project) => JSON.stringify({
  model: { id: 'claude-opus-5-5', display_name: 'Opus' },
  cwd: project,
  session_id: 'session-4f2a',
  session_name: 'acme merger notes',
  transcript_path: path.join(project, 'transcript.jsonl'),
  context_window: { used_percentage: 45, context_window_size: 200_000 },
  version: '2.1.310',
});

test('doctor reports the runtime, the last render and what to fix', () => withHome(({ run, project }) => {
  const before = JSON.parse(run(['doctor']).stdout);
  assert.equal(before.runtime.supported, true);
  assert.equal(before.lastRender, null);
  assert.deepEqual(before.statusLine, { kind: 'none' });
  assert.ok(before.findings.some((finding) => finding.includes('`hud install`')));

  assert.equal(run([], { input: payload(project), columns: 90 }).status, 0);
  const after = JSON.parse(run(['doctor']).stdout);
  assert.equal(after.lastRender.outcome, 'ok');
  assert.equal(after.lastRender.columns, 90);
  assert.equal(after.lastRender.runtime, process.version);
}));

test('doctor redacts a statusLine command and reports disableAllHooks', () => withHome(({ run, configDir, project }) => {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(path.join(configDir, 'settings.json'), JSON.stringify({
    statusLine: { type: 'command', command: 'bash ~/line.sh --token=hunter2' }, disableAllHooks: true,
  }));
  const report = JSON.parse(run(['doctor']).stdout);
  assert.equal(report.statusLine.kind, 'other');
  assert.equal(report.statusLine.scope, 'user');
  assert.equal(report.statusLine.command, 'bash ~/line.sh --token=[REDACTED]');
  assert.ok(report.findings.some((finding) => finding.includes('disableAllHooks')));
  assert.doesNotMatch(JSON.stringify(report), /hunter2/);

  // Project settings win over user settings.
  mkdirSync(path.join(project, '.claude'));
  writeFileSync(path.join(project, '.claude', 'settings.json'), JSON.stringify({ disableAllHooks: false }));
  assert.ok(!JSON.parse(run(['doctor']).stdout).findings.some((finding) => finding.includes('disableAllHooks')));
}));

test('every config key is described for `hud schema`, and nothing else is', () => {
  assert.deepEqual(Object.keys(DESCRIPTIONS).sort(), configKeys().map((entry) => entry.key).sort());
});

test('schema finds keys and notes by word', () => withHome(({ run }) => {
  const lines = run(['schema', 'tools']).stdout.split('\n');
  assert.match(lines[0], /^display\.showTools = false \(true \| false\): /);
  assert.ok(run(['schema', 'refresh']).stdout.includes('refreshInterval'));
  assert.equal(run(['schema']).stdout.trim().split('\n').length, configKeys().length);
}));

test('set rejects a bad value loudly and changes nothing', () => withHome(({ run, configPath }) => {
  const bad = run(['set', 'display.showTools=yes', 'lineLayout=compact']);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /display\.showTools must be true \| false/);
  assert.match(bad.stdout, /Nothing was changed/);
  assert.ok(!existsSync(configPath));

  const unknown = run(['set', 'display.showTool=true']);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stdout, /display\.showTool is not a config key/);
}));

test('set refuses to overwrite a config.json it could not read', () => withHome(({ run, configPath }) => {
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, '{ "display": { "showTools": true }, oops');
  const result = run(['set', 'lineLayout=compact']);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /config\.json is not valid JSON, so set would lose what is in it/);
  assert.equal(readFileSync(configPath, 'utf8'), '{ "display": { "showTools": true }, oops');
}));

test('set refuses the keys that name files; only the user sets those', () => withHome(({ run, configPath }) => {
  const refused = run(['set', 'display.externalUsageWritePath=/home/x/.bashrc.json']);
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /names a file/);
  assert.ok(!existsSync(configPath));
}));

test('set writes config.json, keeps what it did not touch, and --undo puts it back', () => withHome(({ run, configPath }) => {
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify({ pathLevels: 2 }));
  const result = run(['set', 'display.showTools=true', 'elementOrder=["project","context"]', 'display.customLine=Work Team']);
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /Set display\.showTools = true \(was false\)/);
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), {
    pathLevels: 2, display: { showTools: true, customLine: 'Work Team' }, elementOrder: ['project', 'context'],
  });

  assert.equal(run(['set', '--undo']).status, 0);
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), { pathLevels: 2 });
}));

test('preview renders a candidate config without saving it', () => withHome(({ run, project, configPath }) => {
  const sample = run(['preview', '--set', 'lineLayout=compact', '--width', '60']);
  assert.equal(sample.status, 0, sample.stdout);
  assert.match(sample.stdout, /^Preview at 60 columns, with a sample session:\n\[Opus 5\.5\] .*45%/);
  assert.doesNotMatch(sample.stdout, /\x1b/);
  assert.ok(!existsSync(configPath));
  assert.match(run(['preview', '--set', 'language=zh-Hans']).stdout, /上下文/, 'labels follow the candidate config');

  assert.equal(run(['preview', '--last']).status, 1, 'nothing to replay before a render');
  run([], { input: payload(project), columns: 80 });
  const last = run(['preview', '--last', '--state', '{"context_window":{"used_percentage":91}}']);
  assert.match(last.stdout, /replaying the last real render/);
  assert.match(last.stdout, /91%/);
  assert.match(last.stdout, /secret-project/);
}));

// The case schema (verify/case.mjs FIELDS) and a scan for everything private in the input.
const FIELDS = { note: 'string', columns: 'number', stdin: 'object', expect: 'array', config: 'object', versions: 'object',
  platform: 'string', tz: 'string', now: 'string' };

test('report prints a case that fits the fixture schema and leaks nothing private', () => withHome(({ run, project, configPath }) => {
  assert.equal(run(['report']).status, 1, 'nothing to report before a render');
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify({ display: { customLine: 'acme-internal', showCost: true } }));
  run([], { input: payload(project), columns: 80 });

  const result = run(['report', '--note', 'the bar is wrong', '--expect', 'contains 45%']);
  assert.equal(result.status, 0, result.stdout);
  const { case: testCase, actual } = JSON.parse(result.stdout);
  for (const [key, value] of Object.entries(testCase)) assert.equal(Array.isArray(value) ? 'array' : typeof value, FIELDS[key], key);
  assert.deepEqual(testCase.expect, ['exit 0', 'only safe escapes', 'no line wider than columns', 'every line closes its OSC 8 link', 'contains 45%']);
  assert.equal(testCase.columns, 80);
  assert.equal(testCase.stdin.model.display_name, 'Opus');
  assert.equal(testCase.stdin.context_window.used_percentage, 45);
  assert.equal(testCase.config.display.showCost, true);
  assert.equal(testCase.config.display.customLine, 'xxxxxxxxxxxxx', 'free text keeps its width');

  for (const secret of ['secret-project', 'session-4f2a', 'acme', 'merger', path.basename(path.dirname(project))]) {
    assert.doesNotMatch(result.stdout, new RegExp(secret), secret);
  }
  assert.ok(actual.some((line) => line.includes('45%')), 'the scrubbed case still renders');

  const unknown = run(['report', '--expect', 'looks nice']);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stdout, /Not in the case vocabulary/);
}));

test('masking keeps display width: a cell per x, a wide character per 全', () => {
  assert.equal(mask('my-project'), 'xxxxxxxxxx');
  assert.equal(mask('/home/ü/项目'), '/xxxx/x/全全');
  assert.deepEqual(scrubStdin({ cwd: '/a/b', model: { id: 'claude-opus-5-5' }, workspace: { added_dirs: ['/x/lib'] }, n: 3, ok: true }),
    { cwd: '/x/x', model: { id: 'claude-opus-5-5' }, workspace: { added_dirs: ['/x/xxx'] }, n: 3, ok: true });
});

test('a config problem shows as one line ending in /hud, not a silent fallback', () => withHome(({ run, project, configPath }) => {
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify({ display: { showTools: 'yes', contextValue: 'lots' } }));
  const lines = run([], { input: payload(project), columns: 120 }).stdout.trimEnd().split('\n');
  assert.equal(lines.at(-1), 'claude-hud: config.json: display.showTools must be true | false (and 1 more). Type /hud to fix it.');

  writeFileSync(configPath, '{ not json');
  assert.equal(run([], { input: payload(project), columns: 120 }).stdout.trimEnd().split('\n').at(-1),
    'claude-hud: config.json is not valid JSON. Type /hud to fix it.');
}));
