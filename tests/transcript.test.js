import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTranscript } from '../dist/transcript.js';
import { TRANSCRIPT_MODEL_MAX_LEN } from '../dist/model-source.js';

const fixture = (name) => fileURLToPath(new URL(name, import.meta.url));

async function parse(entries) {
  const dir = await mkdtemp(path.join(tmpdir(), 'hud-transcript-'));
  try {
    const file = path.join(dir, 'transcript.jsonl');
    await writeFile(file, entries.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('\n'));
    return await parseTranscript(file);
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
  const r = await parseTranscript(fixture('./golden/transcript.jsonl'));

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
    assert.deepEqual(await parseTranscript(missing), { tools: [], skills: [], mcpServers: [], mcpErrors: [], agents: [], todos: [] });
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

  assert.equal((await parseTranscript(fixture('./fixtures/transcript-ultracode.jsonl'))).ultracodeActive, true);
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
