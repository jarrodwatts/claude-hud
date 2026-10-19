import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, open, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { addSubagentEfforts, parseTranscript } from '../dist/transcript.js';
import { TRANSCRIPT_MODEL_MAX_LEN } from '../dist/model-source.js';

const fixture = (name) => fileURLToPath(new URL(name, import.meta.url));

// Saved parser state lands under the home's .claude, so every test gets its own.
process.env.CLAUDE_CONFIG_DIR = '';
const home = await mkdtemp(path.join(tmpdir(), 'hud-transcript-home-'));
test.after(() => rm(home, { recursive: true, force: true }));

async function parse(entries) {
  const dir = await mkdtemp(path.join(tmpdir(), 'hud-transcript-'));
  try {
    const file = path.join(dir, 'transcript.jsonl');
    await writeFile(file, entries.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('\n'));
    return await parseTranscript(file, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const usage = (input, output = 0, cacheWrite = 0, cacheRead = 0) => ({
  input_tokens: input,
  output_tokens: output,
  cache_creation_input_tokens: cacheWrite,
  cache_read_input_tokens: cacheRead,
});
const assistant = (fields = {}, message = {}) => ({ type: 'assistant', ...fields, message: { role: 'assistant', ...message } });
const toolUse = (id, name, input, timestamp) => assistant({ timestamp }, { content: [{ type: 'tool_use', id, name, input }] });
const toolResult = (id, { timestamp, isError = false, ...fields } = {}) => ({
  type: 'user',
  timestamp,
  ...fields,
  message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError }] },
});
const tokens = (input, output, cacheCreation, cacheRead) => ({
  inputTokens: input,
  outputTokens: output,
  cacheCreationTokens: cacheCreation,
  cacheReadTokens: cacheRead,
});

test('parseTranscript reads a realistic session', async () => {
  const r = await parseTranscript(fixture('./golden/transcript.jsonl'), home);

  assert.deepEqual(r.tools.map((t) => [t.name, t.target, t.status]), [
    ['Read', '/repo/src/auth.ts', 'completed'],
    ['Grep', 'validateToken', 'completed'],
    ['Bash', 'npm test', 'completed'],
    ['Skill', 'frontend-design', 'completed'],
    ['mcp__github__search_issues', undefined, 'error'],
    ['Edit', '/repo/src/auth.ts', 'completed'],
    ['Edit', '/repo/tests/auth.test.ts', 'running'],
  ]);
  assert.deepEqual(r.agents.map((a) => [a.type, a.model, a.status]), [
    ['Explore', 'claude-haiku-4-5-20251001', 'completed'],
    ['general-purpose', undefined, 'running'],
  ]);
  assert.deepEqual(r.todos.map((t) => t.status), ['completed', 'in_progress', 'pending']);
  assert.deepEqual(r.skills, ['frontend-design']);
  assert.deepEqual(r.mcpServers, ['github']);
  assert.deepEqual(r.mcpErrors, ['github']);
  assert.equal(r.sessionStart?.toISOString(), '2026-10-01T11:00:00.000Z');
  assert.equal(r.lastAssistantResponseAt?.toISOString(), '2026-10-01T11:59:00.000Z');
  assert.equal(r.advisorModel, 'claude-opus-5-5');
  assert.equal(r.lastAssistantModel, 'claude-opus-5-5');
  assert.equal(r.compactionCount, 1);
  assert.equal(r.contextTokens, 33_400, 'the last request after the compaction');
  assert.deepEqual(r.sessionTokens, tokens(5_600, 1_750, 26_500, 227_900));
});

test('parseTranscript returns an empty result for a missing file and skips malformed lines', async () => {
  for (const missing of ['', '/no/such/transcript.jsonl', tmpdir()]) {
    assert.deepEqual(await parseTranscript(missing, home), { tools: [], skills: [], mcpServers: [], mcpErrors: [], agents: [], todos: [] });
  }
  const r = await parse(['{not json', '42', toolUse('t1', 'Read', { file_path: '/a' }), '', '{"type":']);
  assert.equal(r.tools.length, 1);
});

test('session tokens take the per-field max per message id, wherever the duplicates sit', async () => {
  const r = await parse([
    assistant({}, { id: 'a', usage: {} }),
    assistant({}, { id: 'a', usage: usage(100, 25, 10, 5) }),
    assistant({}, { id: 'b', usage: usage(100, 25, 10, 5) }),
    { type: 'user' },
    assistant({}, { id: 'a', usage: usage(120, 5, 0, 0) }),
    assistant({}, { id: 'c', usage: { input_tokens: 'x', output_tokens: -3, cache_read_input_tokens: 7.9 } }),
  ]);
  assert.deepEqual(r.sessionTokens, tokens(220, 50, 20, 17));
});

test('session tokens dedupe idless records only when adjacent and bound retained ids', async () => {
  const idless = assistant({}, { usage: usage(100, 25, 10, 5) });
  const r = await parse([
    idless,
    idless,
    { type: 'user' },
    idless,
    assistant({}, { id: { nested: 1 }, usage: usage(1) }),
    { type: 'user' },
    assistant({}, { id: 'x'.repeat(129), usage: usage(1) }),
  ]);
  assert.deepEqual(r.sessionTokens, tokens(202, 50, 20, 10));

  const ids = Array.from({ length: 4097 }, (_, i) => assistant({}, { id: `m${i}`, usage: usage(1) }));
  const bounded = await parse([...ids, assistant({}, { id: 'm0', usage: usage(1) })]);
  assert.equal(bounded.sessionTokens?.inputTokens, 4098, 'an evicted id that reappears counts again');
});

test('contextTokens tracks the main conversation and compactions', async () => {
  const at = (s) => `2026-10-01T00:00:0${s}.000Z`;
  const r = await parse([
    assistant({ timestamp: at(1) }, { usage: usage(1_000, 0, 500, 8_500) }),
    assistant({ timestamp: at(2), isSidechain: true }, { usage: usage(99_000) }),
  ]);
  assert.equal(r.contextTokens, 10_000, 'subagent requests run against their own context');

  // #809: a gateway's per-block thinking record carries all-zero usage mid-stream.
  const streaming = await parse([
    assistant({ timestamp: at(1) }, { usage: usage(1_000, 0, 500, 8_500) }),
    assistant({ timestamp: at(2) }, { content: [{ type: 'thinking', thinking: '' }], usage: usage(0) }),
  ]);
  assert.equal(streaming.contextTokens, 10_000, 'a zero-usage record keeps the last real size');

  const compacted = await parse([
    assistant({ timestamp: at(1) }, { usage: usage(50_000) }),
    { type: 'system', subtype: 'compact_boundary' },
    { type: 'system', subtype: 'compact_boundary', timestamp: at(2), compactMetadata: { postTokens: 12_000 } },
  ]);
  assert.equal(compacted.contextTokens, 12_000);
  assert.equal(compacted.compactionCount, 1, 'boundaries without a timestamp are not counted');

  const unknown = await parse([
    assistant({ timestamp: at(1) }, { usage: usage(50_000) }),
    { type: 'system', subtype: 'compact_boundary', timestamp: at(2) },
  ]);
  assert.equal(unknown.contextTokens, undefined);
});

test('the served model is sanitized, capped, and skips synthetic records', async () => {
  const r = await parse([
    assistant({}, { model: 'glm-5' }),
    assistant({}, { model: '<synthetic>' }),
  ]);
  assert.equal(r.lastAssistantModel, 'glm-5');

  const hostile = await parse([assistant({}, { model: `\x1b[31m${'m'.repeat(200)}` })]);
  assert.equal(hostile.lastAssistantModel, 'm'.repeat(TRANSCRIPT_MODEL_MAX_LEN));
});

test('the advisor model comes from the latest non-empty assistant record', async () => {
  const r = await parse([
    assistant({ advisorModel: 'claude-opus-5-5' }),
    assistant({ advisorModel: '' }),
    { type: 'user', advisorModel: 'ignored' },
    assistant({ advisorModel: 'x'.repeat(100) }),
  ]);
  assert.equal(r.advisorModel, 'x'.repeat(64));
  assert.equal((await parse([assistant()])).advisorModel, undefined);
});

test('ultracode follows the latest enter/exit attachment or /effort output', async () => {
  const enter = { type: 'attachment', attachment: { type: 'ultra_effort_enter' } };
  const exit = { type: 'attachment', attachment: { type: 'ultra_effort_exit' } };
  const effort = (level) => ({ type: 'user', message: { content: `<local-command-stdout>Set effort level to ${level} (this session only): x</local-command-stdout>` } });

  assert.equal((await parseTranscript(fixture('./fixtures/transcript-ultracode.jsonl'), home)).ultracodeActive, true);
  assert.equal((await parse([assistant()])).ultracodeActive, undefined);
  assert.equal((await parse([enter, exit])).ultracodeActive, false);
  assert.equal((await parse([enter, effort('xhigh')])).ultracodeActive, false);
  assert.equal((await parse([effort('ultracode'), effort('high'), enter])).ultracodeActive, true);
  assert.equal((await parse([{ type: 'user', message: { content: 'try "Set effort level to ultracode"' } }])).ultracodeActive, undefined);
  assert.equal((await parse([assistant({}, { content: [{ type: 'text', text: 'ultra_effort_enter' }] })])).ultracodeActive, undefined);
});

test('agents report the resolved model, and background agents finish at their queue completion', async () => {
  const r = await parse([
    toolUse('fg', 'Agent', { subagent_type: 'Explore', model: 'haiku' }, '2026-10-01T00:00:00.000Z'),
    toolResult('fg', { timestamp: '2026-10-01T00:00:05.000Z', toolUseResult: { resolvedModel: '\x1b[1mclaude-haiku-4-5' } }),
    toolUse('bg', 'Task', { subagent_type: 'general-purpose', run_in_background: true }, '2026-10-01T00:00:01.000Z'),
    toolResult('bg', { timestamp: '2026-10-01T00:00:02.000Z' }),
    toolUse('async', 'Agent', {}, '2026-10-01T00:00:01.000Z'),
    toolResult('async', { timestamp: '2026-10-01T00:00:02.000Z', toolUseResult: { status: 'async_launched', resolvedModel: 42 } }),
    { type: 'queue-operation', operation: 'enqueue', timestamp: '2026-10-01T00:01:00.000Z', content: '<task-id>t</task-id><tool-use-id>bg</tool-use-id>' },
    { type: 'queue-operation', operation: 'enqueue', timestamp: '2026-10-01T00:01:00.000Z', content: '<tool-use-id>async</tool-use-id>' },
  ]);
  const [fg, bg, async] = r.agents;
  assert.deepEqual([fg.model, fg.status, fg.endTime?.toISOString()], ['claude-haiku-4-5', 'completed', '2026-10-01T00:00:05.000Z']);
  assert.deepEqual([bg.background, bg.status, bg.endTime?.toISOString()], [true, 'completed', '2026-10-01T00:01:00.000Z']);
  assert.deepEqual([async.type, async.background, async.status], ['agent', true, 'running'], 'needs a task-id to complete');
});

test('a notification missing <tool-use-id> still completes its agent via the launch agentId', async () => {
  const r = await parse([
    toolUse('fork1', 'Agent', { subagent_type: 'fork' }, '2026-10-01T00:00:01.000Z'),
    toolResult('fork1', { timestamp: '2026-10-01T00:00:02.000Z', toolUseResult: { status: 'async_launched', agentId: 'a1b2c3' } }),
    { type: 'queue-operation', operation: 'enqueue', timestamp: '2026-10-01T00:01:00.000Z', content: '<task-notification>\n<task-id>a1b2c3</task-id>\n<output-file>...</output-file>\n<status>completed</status>\n</task-notification>' },
  ]);
  const [fork1] = r.agents;
  assert.deepEqual([fork1.background, fork1.status, fork1.endTime?.toISOString()], [true, 'completed', '2026-10-01T00:01:00.000Z']);
});

test('a queued_command attachment also completes its agent, keeping the earliest of both carriers', async () => {
  const launch = [
    toolUse('qc1', 'Agent', {}, '2026-10-01T00:00:01.000Z'),
    toolResult('qc1', { timestamp: '2026-10-01T00:00:02.000Z', toolUseResult: { status: 'async_launched', agentId: 'a1' } }),
  ];
  const notice = '<task-notification>\n<task-id>a1</task-id>\n<tool-use-id>qc1</tool-use-id>\n<status>completed</status>\n</task-notification>';
  const enqueue = { type: 'queue-operation', operation: 'enqueue', timestamp: '2026-10-01T00:01:00.000Z', content: notice };
  const attachment = (prompt, type = 'queued_command', timestamp = '2026-10-01T00:05:00.000Z') => ({ type: 'attachment', timestamp, attachment: { type, prompt } });
  const endOf = async (...entries) => (await parse([...launch, ...entries])).agents[0].endTime?.toISOString();

  assert.equal(await endOf(attachment(notice)), '2026-10-01T00:05:00.000Z');
  assert.equal(await endOf(enqueue, attachment(notice)), '2026-10-01T00:01:00.000Z');
  assert.equal(await endOf(attachment(notice), enqueue), '2026-10-01T00:01:00.000Z');
  for (const ignored of [attachment('is the agent done yet?'), attachment([{ type: 'text', text: notice }]), attachment(notice, 'other'), attachment(notice, 'queued_command', null)]) {
    assert.equal(await endOf(ignored), undefined);
  }
});

test('TaskCreate ids survive TodoWrite rewrites, including duplicate content', async () => {
  const r = await parse([
    toolUse('c1', 'TaskCreate', { subject: 'Ship', taskId: 'task-a' }),
    toolUse('c2', 'TaskCreate', { subject: 'Ship', taskId: 'task-b' }),
    toolUse('c3', 'TaskCreate', { description: 'Write docs' }),
    toolUse('w1', 'TodoWrite', { todos: [
      { content: 'Write docs', status: 'pending' },
      { content: 'Ship', status: 'pending' },
      { content: 'Ship', status: 'pending' },
    ] }),
    toolUse('u1', 'TaskUpdate', { taskId: 'task-b', status: 'done' }),
    toolUse('u2', 'TaskUpdate', { taskId: 'c3', status: 'running', subject: 'Write the docs' }),
    toolUse('u3', 'TaskUpdate', { taskId: '2', status: 'complete' }),
    toolUse('u4', 'TaskUpdate', { taskId: 'missing', status: 'done' }),
  ]);
  assert.deepEqual(r.todos.map(({ content, status }) => [content, status]), [
    ['Write the docs', 'in_progress'],
    ['Ship', 'completed'],
    ['Ship', 'completed'],
  ]);
  assert.equal(r.tools.length, 0, 'task tools are not activity');
});

test('MCP errors follow each server\'s latest result and are sanitized and bounded', async () => {
  const call = (id, server, isError) => [toolUse(id, `mcp__${server}__run`, {}), toolResult(id, { isError })];
  const r = await parse([
    ...call('1', 'github', true),
    ...call('2', 'linear', true),
    ...call('3', 'github', false),
    ...call('4', '\x1b[31mevil', true),
    toolUse('5', 'Bash', { command: 'false' }),
    toolResult('5', { isError: true }),
  ]);
  assert.deepEqual(r.mcpErrors, ['linear', 'evil']);

  const many = await parse(Array.from({ length: 70 }, (_, i) => call(String(i), `s${i}`, true)).flat());
  assert.equal(many.mcpErrors.length, 64);
  assert.equal(many.mcpErrors[0], 's6');
});

test('tool targets summarize common tools and only the last 20 tools are kept', async () => {
  const r = await parse([
    toolUse('1', 'Read', { file_path: '/a.ts' }),
    toolUse('2', 'Write', { path: '/b.ts' }),
    toolUse('3', 'Glob', { pattern: '**/*.ts' }),
    toolUse('4', 'Grep', { pattern: 'TODO' }),
    toolUse('5', 'Bash', { command: 'npm   run\n  build -- --watch --verbose --long-flag' }),
    toolUse('6', 'Skill', { skill: '' }),
    toolUse('7', 'WebFetch', { url: 'https://x' }),
  ]);
  assert.deepEqual(r.tools.map((t) => t.target), ['/a.ts', '/b.ts', '**/*.ts', 'TODO', 'npm run build -- --watch --ver...', undefined, undefined]);
  assert.deepEqual(r.skills, []);

  const many = await parse(Array.from({ length: 25 }, (_, i) => toolUse(String(i), 'Read', { file_path: `/${i}` })));
  assert.equal(many.tools.length, 20);
  assert.equal(many.tools[0].target, '/5');
});

test('model-written tool inputs are sanitized before display', async () => {
  const evil = '\x1b]8;;https://evil.test\x07fix\x1b[31m it‮\x1b]8;;\x07';
  const r = await parse([
    toolUse('t1', 'Edit', { file_path: `/repo/${evil}.ts` }),
    toolUse('t2', 'TodoWrite', { todos: [{ content: evil, status: 'in_progress' }, { content: 42, status: 'pending' }] }),
    toolUse('t3', 'TaskCreate', { subject: evil }),
  ]);
  assert.equal(r.tools[0].target, '/repo/fix it.ts');
  assert.deepEqual(r.todos, [{ content: 'fix it', status: 'in_progress' }, { content: 'fix it', status: 'pending' }]);
});

test('subagent effort comes from the first assistant record of the subagent transcript', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hud-transcript-'));
  try {
    const file = path.join(dir, 'session.jsonl');
    const launch = (id, agentId) => [toolUse(id, 'Agent', { subagent_type: id }), toolResult(id, { toolUseResult: { agentId } })];
    await writeFile(file, [...launch('known', 'a1'), ...launch('unreplied', 'a2'), ...launch('missing', 'a3'), ...launch('long', 'a4'), ...launch('escape', '../a1'), toolUse('noid', 'Agent', {})]
      .map((e) => JSON.stringify(e)).join('\n'));
    const subagents = path.join(dir, 'session', 'subagents');
    await mkdir(subagents, { recursive: true });
    const lines = (...entries) => entries.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('\n');
    await writeFile(path.join(subagents, 'agent-a1.jsonl'), lines({ type: 'user', effort: 'low' }, '{oops', { type: 'assistant', effort: 'medium' }, { type: 'assistant', effort: 'max' }));
    await writeFile(path.join(subagents, 'agent-a2.jsonl'), lines({ type: 'user' }));
    await writeFile(path.join(subagents, 'agent-a4.jsonl'), lines({ type: 'user', prompt: 'x'.repeat(3 << 20) }, { type: 'assistant', effort: 'high' }));
    await writeFile(path.join(dir, 'agent-a1.jsonl'), lines({ type: 'assistant', effort: 'max' }));

    const r = await parseTranscript(file, dir);
    await addSubagentEfforts(file, r.agents);
    assert.deepEqual(r.agents.map((a) => [a.type, a.agentId, a.effort]), [
      ['known', 'a1', 'medium'],
      ['unreplied', 'a2', undefined],
      ['missing', 'a3', undefined],
      ['long', 'a4', 'high'],
      ['escape', '../a1', undefined],
      ['agent', undefined, undefined],
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('each run reads only what was appended since the last, and gets the same result as a full read', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hud-transcript-'));
  try {
    const source = await readFile(fixture('./golden/transcript.jsonl'), 'utf8');
    const expected = await parseTranscript(fixture('./golden/transcript.jsonl'), dir);
    const file = path.join(dir, 'transcript.jsonl');
    await writeFile(file, '');
    // Uneven steps, so some runs end mid-line.
    for (let at = 0; at < source.length; at += 997) {
      await appendFile(file, source.slice(at, at + 997));
      await parseTranscript(file, dir);
    }
    // Saved state drops undefined-valued keys, which nothing distinguishes from absent ones.
    const plain = (value) => JSON.parse(JSON.stringify(value));
    assert.deepEqual(plain(await parseTranscript(file, dir)), plain(expected));

    // Same size and file, but earlier bytes changed: the saved state wins, so nothing was reread.
    const sessionStart = /"timestamp":"[^"]+"/;
    await writeFile(file, source.replace(sessionStart, `"timestamp":"${expected.sessionStart.toISOString().replace(/^\d{4}/, '1999')}"`), { flag: 'r+' });
    assert.deepEqual((await parseTranscript(file, dir)).sessionStart, expected.sessionStart);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a replaced or shorter transcript is read from the start', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hud-transcript-'));
  try {
    const file = path.join(dir, 'transcript.jsonl');
    const reads = (prefix, n) => Array.from({ length: n }, (_, i) => JSON.stringify(toolUse(`${prefix}${i}`, 'Read', {})) + '\n').join('');
    const ids = async () => (await parseTranscript(file, dir)).tools.map((t) => t.id);
    await writeFile(file, reads('a', 3));
    assert.deepEqual(await ids(), ['a0', 'a1', 'a2']);

    await writeFile(file, reads('b', 2));
    assert.deepEqual(await ids(), ['b0', 'b1'], 'shorter');

    // Kept open so the replacement can't reuse its inode.
    const held = await open(file, 'r');
    try {
      await rm(file);
      await writeFile(file, reads('c', 4));
      assert.deepEqual(await ids(), ['c0', 'c1', 'c2', 'c3'], 'replaced');
    } finally {
      await held.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('saved parser state is kept for the 32 most recent transcripts', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hud-transcript-'));
  try {
    for (let i = 0; i < 34; i++) {
      const file = path.join(dir, `${i}.jsonl`);
      await writeFile(file, JSON.stringify(toolUse('t', 'Read', {})) + '\n');
      await parseTranscript(file, dir);
    }
    assert.equal((await readdir(path.join(dir, '.claude', 'plugins', 'claude-hud', 'transcript-cursors'))).length, 32);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a background agent completes however many other tasks and agents send notices', async () => {
  const notice = (id, timestamp) => ({ type: 'queue-operation', operation: 'enqueue', timestamp, content: `<task-notification><task-id>x</task-id><tool-use-id>${id}</tool-use-id></task-notification>` });
  const launch = (id) => [toolUse(id, 'Agent', { run_in_background: true }), toolResult(id, { toolUseResult: { status: 'async_launched' } })];
  const others = Array.from({ length: 70 }, (_, i) => i);
  const r = await parse([
    ...launch('bg'),
    notice('bg', '2026-10-01T00:00:01.000Z'),
    ...others.map((i) => notice(`bash${i}`, '2026-10-01T00:00:02.000Z')),
  ]);
  assert.equal(r.agents.find((a) => a.id === 'bg')?.status, 'completed');

  // Past the tracked limit, the oldest agents go with their completions; the newest still complete.
  const many = await parse([
    ...others.flatMap((i) => launch(`a${i}`)),
    ...others.map((i) => notice(`a${i}`, '2026-10-01T00:00:03.000Z')),
  ]);
  assert.equal(many.agents.length, 10);
  assert.ok(many.agents.every((a) => a.status === 'completed'));
});

test('saved state that no longer parses is dropped and the transcript reread', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hud-transcript-'));
  try {
    const file = path.join(dir, 'transcript.jsonl');
    await writeFile(file, JSON.stringify(toolUse('t1', 'Read', { file_path: '/a' })) + '\n');
    const { version } = JSON.parse(await readFile(fixture('../package.json'), 'utf8'));
    const cursors = path.join(dir, '.claude', 'plugins', 'claude-hud', 'transcript-cursors');
    await parseTranscript(file, dir);
    const cursorFile = path.join(cursors, `${createHash('sha256').update(path.resolve(file)).digest('hex')}.json`);
    const cursor = JSON.parse(await readFile(cursorFile, 'utf8'));
    assert.equal(cursor.version, version);
    await appendFile(file, JSON.stringify(toolUse('t2', 'Read', { file_path: '/b' })) + '\n');
    for (const bad of [{ ...cursor, state: { ...cursor.state, tools: 5 } }, null]) {
      await writeFile(cursorFile, JSON.stringify(bad));
      assert.deepEqual((await parseTranscript(file, dir)).tools.map((t) => t.id), ['t1', 't2']);
      assert.equal(JSON.parse(await readFile(cursorFile, 'utf8')).state.tools.length, 2, 'the bad cursor is replaced');
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
