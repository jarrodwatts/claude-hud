import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, utimes, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { extractSshTarget, collectSshTargets } from '../dist/ssh-targets.js';

// ---------------------------------------------------------------------------
// extractSshTarget — pure tokenizer over a single shell command string
// ---------------------------------------------------------------------------

test('extractSshTarget parses user@ipv4 with default port 22', () => {
  assert.deepEqual(
    extractSshTarget('ssh cloud-user@44.245.72.210 nvidia-smi'),
    { host: '44.245.72.210', port: 22 },
  );
});

test('extractSshTarget reads -p PORT', () => {
  assert.deepEqual(
    extractSshTarget('ssh -p 2222 user@host.example.com'),
    { host: 'host.example.com', port: 2222 },
  );
});

test('extractSshTarget reads attached -pPORT', () => {
  assert.deepEqual(
    extractSshTarget('ssh -p2222 user@1.2.3.4'),
    { host: '1.2.3.4', port: 2222 },
  );
});

test('extractSshTarget skips value-taking options (-i, -o) before the host', () => {
  assert.deepEqual(
    extractSshTarget('ssh -i ~/.ssh/key -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new cloud-user@10.0.0.5 uptime'),
    { host: '10.0.0.5', port: 22 },
  );
});

test('extractSshTarget ignores ssh-keygen and ssh-add', () => {
  assert.equal(extractSshTarget('ssh-keygen -l -f key.pub'), null);
  assert.equal(extractSshTarget('ssh-add -l'), null);
});

test('extractSshTarget does not treat "echo ssh x" as an ssh invocation', () => {
  assert.equal(extractSshTarget('echo ssh not-a-host'), null);
});

test('extractSshTarget finds ssh after a command separator', () => {
  assert.deepEqual(
    extractSshTarget("cd /tmp && ssh user@node1.internal.example.com 'ls -la'"),
    { host: 'node1.internal.example.com', port: 22 },
  );
});

test('extractSshTarget honors a leading sudo', () => {
  assert.deepEqual(
    extractSshTarget('sudo ssh root@10.1.2.3'),
    { host: '10.1.2.3', port: 22 },
  );
});

test('extractSshTarget rejects a single-label host (no dot, not ipv4)', () => {
  assert.equal(extractSshTarget('ssh myalias'), null);
});

test('extractSshTarget falls back to port 22 on an out-of-range port', () => {
  assert.deepEqual(
    extractSshTarget('ssh -p 99999 user@1.2.3.4'),
    { host: '1.2.3.4', port: 22 },
  );
});

test('extractSshTarget takes the last ssh invocation on a chained line', () => {
  assert.deepEqual(
    extractSshTarget('ssh a.example.com; ssh b.example.com'),
    { host: 'b.example.com', port: 22 },
  );
});

// ---------------------------------------------------------------------------
// collectSshTargets — session-scoped: main transcript + <sid>/subagents/*.jsonl
// ---------------------------------------------------------------------------

function bashLine(command) {
  return JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'Bash', input: { command } }] },
  });
}

async function makeSession(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'sshhud-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sid = 'session-abc';
  const transcriptPath = path.join(dir, `${sid}.jsonl`);
  const subagentsDir = path.join(dir, sid, 'subagents');
  await mkdir(subagentsDir, { recursive: true });
  return { dir, sid, transcriptPath, subagentsDir };
}

test('collectSshTargets returns the main target first, then subagents', async (t) => {
  const s = await makeSession(t);
  await writeFile(s.transcriptPath, [bashLine('ssh main-user@10.0.0.1')].join('\n'));
  await writeFile(path.join(s.subagentsDir, 'agent-aaaaaa111.jsonl'), bashLine('ssh sub@10.0.0.2'));

  const targets = collectSshTargets(s.transcriptPath);
  assert.equal(targets.length, 2);
  assert.deepEqual(
    { host: targets[0].host, port: targets[0].port, source: targets[0].source },
    { host: '10.0.0.1', port: 22, source: 'main' },
  );
  assert.equal(targets[1].source, 'subagent');
  assert.equal(targets[1].host, '10.0.0.2');
  assert.equal(targets[1].agentId, 'aaaaaa111');
});

test('collectSshTargets takes the most recent ssh target per source', async (t) => {
  const s = await makeSession(t);
  await writeFile(
    s.transcriptPath,
    [bashLine('ssh user@10.0.0.1'), bashLine('ssh user@10.0.0.9')].join('\n'),
  );
  const targets = collectSshTargets(s.transcriptPath);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].host, '10.0.0.9');
});

test('collectSshTargets caps subagents at 3 (most recently active)', async (t) => {
  const s = await makeSession(t);
  await writeFile(s.transcriptPath, bashLine('echo no-ssh-here'));
  const mk = async (name, host, mtimeSec) => {
    const p = path.join(s.subagentsDir, name);
    await writeFile(p, bashLine(`ssh sub@${host}`));
    await utimes(p, mtimeSec, mtimeSec);
  };
  await mk('agent-a.jsonl', '10.0.0.1', 1000);
  await mk('agent-b.jsonl', '10.0.0.2', 2000);
  await mk('agent-c.jsonl', '10.0.0.3', 3000);
  await mk('agent-d.jsonl', '10.0.0.4', 4000);

  const targets = collectSshTargets(s.transcriptPath);
  assert.equal(targets.length, 3, 'main has no ssh, so only 3 subagents');
  assert.deepEqual(
    targets.map(t => t.host),
    ['10.0.0.4', '10.0.0.3', '10.0.0.2'],
    'newest three subagents, most recent first',
  );
});

test('collectSshTargets returns only subagents when main has no ssh', async (t) => {
  const s = await makeSession(t);
  await writeFile(s.transcriptPath, bashLine('ls -la'));
  await writeFile(path.join(s.subagentsDir, 'agent-x1.jsonl'), bashLine('ssh sub@1.2.3.4'));
  const targets = collectSshTargets(s.transcriptPath);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].source, 'subagent');
});

test('collectSshTargets returns just the main target when no subagents dir exists', async (t) => {
  const s = await makeSession(t);
  await rm(path.join(s.dir, s.sid), { recursive: true, force: true });
  await writeFile(s.transcriptPath, bashLine('ssh user@5.6.7.8'));
  const targets = collectSshTargets(s.transcriptPath);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].source, 'main');
  assert.equal(targets[0].host, '5.6.7.8');
});

test('collectSshTargets returns [] for a missing transcript', () => {
  assert.deepEqual(collectSshTargets('/no/such/transcript.jsonl'), []);
});

test('collectSshTargets is session-scoped: it ignores sibling sessions in the same project dir', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sshhud-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  // Session A (the one we query) + its subagent.
  const aPath = path.join(dir, 'sess-A.jsonl');
  await writeFile(aPath, bashLine('ssh a-user@10.0.0.1'));
  const aSub = path.join(dir, 'sess-A', 'subagents');
  await mkdir(aSub, { recursive: true });
  await writeFile(path.join(aSub, 'agent-a1.jsonl'), bashLine('ssh a-sub@10.0.0.2'));

  // Sibling session B with different hosts — must never leak into A's result.
  const bPath = path.join(dir, 'sess-B.jsonl');
  await writeFile(bPath, bashLine('ssh b-user@192.168.9.9'));
  const bSub = path.join(dir, 'sess-B', 'subagents');
  await mkdir(bSub, { recursive: true });
  await writeFile(path.join(bSub, 'agent-b1.jsonl'), bashLine('ssh b-sub@192.168.9.10'));

  const hosts = collectSshTargets(aPath).map(target => target.host);
  assert.deepEqual([...hosts].sort(), ['10.0.0.1', '10.0.0.2']);
  assert.ok(!hosts.includes('192.168.9.9'), 'must not include sibling session host');
  assert.ok(!hosts.includes('192.168.9.10'), 'must not include sibling subagent host');
});
