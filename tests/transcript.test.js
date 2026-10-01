import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { _setCreateReadStreamForTests, parseTranscript } from '../dist/transcript.js';
import { TRANSCRIPT_MODEL_MAX_LEN } from '../dist/model-source.js';

function restoreEnvVar(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

async function getTranscriptCacheFile(configDir) {
  const cacheDir = path.join(configDir, 'plugins', 'claude-hud', 'transcript-cache');
  const files = await readdir(cacheDir);
  assert.equal(files.length, 1, `expected exactly one transcript cache file in ${cacheDir}`);
  return path.join(cacheDir, files[0]);
}

async function parseTempTranscript(name, entries) {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-'));
  const filePath = path.join(dir, name);
  const lines = entries.map(entry => typeof entry === 'string' ? entry : JSON.stringify(entry));
  await writeFile(filePath, lines.join('\n'), 'utf8');

  try {
    return await parseTranscript(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('parseTranscript aggregates tools, agents, and todos', async () => {
  const fixturePath = fileURLToPath(new URL('./fixtures/transcript-basic.jsonl', import.meta.url));
  const result = await parseTranscript(fixturePath);
  assert.equal(result.tools.length, 1);
  assert.equal(result.tools[0].status, 'completed');
  assert.equal(result.tools[0].target, '/tmp/example.txt');
  assert.equal(result.agents.length, 1);
  assert.equal(result.agents[0].status, 'completed');
  assert.equal(result.todos.length, 4);
  assert.equal(result.todos[0].status, 'completed');
  assert.equal(result.todos[1].status, 'in_progress');
  assert.equal(result.todos[2].content, 'Third task');
  assert.equal(result.todos[2].status, 'completed');
  assert.equal(result.todos[3].status, 'in_progress');
  assert.equal(result.sessionStart?.toISOString(), '2024-01-01T00:00:00.000Z');
});

test('parseTranscript accumulates session token usage from assistant messages', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-'));
  const filePath = path.join(dir, 'session-tokens.jsonl');
  const lines = [
    JSON.stringify({
      type: 'assistant',
      message: {
        usage: {
          input_tokens: 1200,
          output_tokens: 300,
          cache_creation_input_tokens: 9000,
          cache_read_input_tokens: 1500,
        },
      },
    }),
    JSON.stringify({
      type: 'assistant',
      message: {
        usage: {
          input_tokens: 800,
          output_tokens: 200,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 500,
        },
      },
    }),
  ];

  await writeFile(filePath, lines.join('\n'), 'utf8');

  try {
    const result = await parseTranscript(filePath);
    assert.deepEqual(result.sessionTokens, {
      inputTokens: 2000,
      outputTokens: 500,
      cacheCreationTokens: 9000,
      cacheReadTokens: 2000,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('parseTranscript sanitizes and caps assistant model IDs at ingestion', async () => {
  const malicious = `proxy-\x1b[31mred\x1b[0m\x1b]8;;https://evil.test\x07link\x1b]8;;\x07\u202E${'x'.repeat(100)}`;
  const result = await parseTempTranscript('transcript-model-sanitization.jsonl', [
    { type: 'assistant', message: { model: malicious } },
  ]);

  assert.ok(result.lastAssistantModel?.startsWith('proxy-redlink'));
  assert.equal(result.lastAssistantModel?.length, 80);
  assert.doesNotMatch(result.lastAssistantModel ?? '', /[\x1b\u202E]/u);
});

test('parseTranscript ignores synthetic assistant model records', async () => {
  const result = await parseTempTranscript('transcript-model-synthetic.jsonl', [
    { type: 'assistant', message: { model: 'deepseek-v4-flash' } },
    { type: 'assistant', message: { model: '<synthetic>' } },
  ]);

  assert.equal(result.lastAssistantModel, 'deepseek-v4-flash');
});

test('parseTranscript deduplicates adjacent duplicate assistant usage by message.id', async () => {
  const usageEntry = {
    type: 'assistant',
    message: {
      id: 'msg-001',
      usage: {
        input_tokens: 100,
        output_tokens: 25,
        cache_creation_input_tokens: 10,
        cache_read_input_tokens: 5,
      },
    },
  };

  const result = await parseTempTranscript('session-tokens-adjacent-duplicate.jsonl', [
    usageEntry,
    usageEntry,
  ]);

  assert.deepEqual(result.sessionTokens, {
    inputTokens: 100,
    outputTokens: 25,
    cacheCreationTokens: 10,
    cacheReadTokens: 5,
  });
});

test('parseTranscript deduplicates non-consecutive duplicate assistant usage by message.id', async () => {
  const usageEntry = {
    type: 'assistant',
    message: {
      id: 'msg-002',
      usage: {
        input_tokens: 100,
        output_tokens: 25,
        cache_creation_input_tokens: 10,
        cache_read_input_tokens: 5,
      },
    },
  };

  const result = await parseTempTranscript('session-tokens-separated-duplicate.jsonl', [
    usageEntry,
    { type: 'user', timestamp: '2024-01-01T00:00:01.000Z' },
    usageEntry,
  ]);

  assert.deepEqual(result.sessionTokens, {
    inputTokens: 100,
    outputTokens: 25,
    cacheCreationTokens: 10,
    cacheReadTokens: 5,
  });
});

test('parseTranscript replaces a zero placeholder with later message usage', async () => {
  const result = await parseTempTranscript('session-tokens-placeholder.jsonl', [
    { type: 'assistant', message: { id: 'msg-placeholder', usage: {} } },
    {
      type: 'assistant',
      message: {
        id: 'msg-placeholder',
        usage: {
          input_tokens: 100,
          output_tokens: 25,
          cache_creation_input_tokens: 10,
          cache_read_input_tokens: 5,
        },
      },
    },
  ]);

  assert.deepEqual(result.sessionTokens, {
    inputTokens: 100,
    outputTokens: 25,
    cacheCreationTokens: 10,
    cacheReadTokens: 5,
  });
});

test('parseTranscript adds only positive per-field message usage deltas', async () => {
  const result = await parseTempTranscript('session-tokens-progressive.jsonl', [
    {
      type: 'assistant',
      message: { id: 'msg-progressive', usage: { input_tokens: 100, output_tokens: 10 } },
    },
    {
      type: 'assistant',
      message: { id: 'msg-progressive', usage: { input_tokens: 80, output_tokens: 25 } },
    },
    {
      type: 'assistant',
      message: { id: 'msg-progressive', usage: { input_tokens: 120, output_tokens: 25 } },
    },
  ]);

  assert.deepEqual(result.sessionTokens, {
    inputTokens: 120,
    outputTokens: 25,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  });
});

test('parseTranscript counts different message IDs with identical usage', async () => {
  const usage = {
    input_tokens: 100,
    output_tokens: 25,
    cache_creation_input_tokens: 10,
    cache_read_input_tokens: 5,
  };

  const result = await parseTempTranscript('session-tokens-distinct-ids.jsonl', [
    { type: 'assistant', message: { id: 'msg-a', usage } },
    { type: 'assistant', message: { id: 'msg-b', usage } },
  ]);

  assert.deepEqual(result.sessionTokens, {
    inputTokens: 200,
    outputTokens: 50,
    cacheCreationTokens: 20,
    cacheReadTokens: 10,
  });
});

test('parseTranscript deduplicates adjacent idless usage with the legacy fingerprint fallback', async () => {
  const entry = {
    type: 'assistant',
    message: {
      usage: {
        input_tokens: 100,
        output_tokens: 25,
        cache_creation_input_tokens: 10,
        cache_read_input_tokens: 5,
      },
    },
  };

  const result = await parseTempTranscript('session-tokens-idless-adjacent.jsonl', [entry, entry]);

  assert.deepEqual(result.sessionTokens, {
    inputTokens: 100,
    outputTokens: 25,
    cacheCreationTokens: 10,
    cacheReadTokens: 5,
  });
});

test('parseTranscript treats malformed and oversized message IDs as idless', async () => {
  const usage = {
    input_tokens: 100,
    output_tokens: 25,
    cache_creation_input_tokens: 10,
    cache_read_input_tokens: 5,
  };
  const objectIdEntry = {
    type: 'assistant',
    message: { id: { nested: 'payload' }, usage },
  };
  const oversizedIdEntry = {
    type: 'assistant',
    message: { id: 'x'.repeat(129), usage },
  };
  const nonStringIdEntry = {
    type: 'assistant',
    message: { id: 42, usage },
  };

  const result = await parseTempTranscript('session-tokens-invalid-ids.jsonl', [
    objectIdEntry,
    objectIdEntry,
    { type: 'user', timestamp: '2024-01-01T00:00:01.000Z' },
    oversizedIdEntry,
    oversizedIdEntry,
    { type: 'user', timestamp: '2024-01-01T00:00:02.000Z' },
    nonStringIdEntry,
    nonStringIdEntry,
  ]);

  assert.deepEqual(result.sessionTokens, {
    inputTokens: 300,
    outputTokens: 75,
    cacheCreationTokens: 30,
    cacheReadTokens: 15,
  });
});

test('parseTranscript bounds retained message IDs', async () => {
  const entries = Array.from({ length: 4097 }, (_, index) => ({
    type: 'assistant',
    message: {
      id: `msg-${index}`,
      usage: { input_tokens: 1 },
    },
  }));
  entries.push({
    type: 'assistant',
    message: {
      id: 'msg-0',
      usage: { input_tokens: 1 },
    },
  });

  const result = await parseTempTranscript('session-tokens-bounded-message-ids.jsonl', entries);

  assert.equal(result.sessionTokens?.inputTokens, 4098);
});

test('parseTranscript records the most recent compact_boundary and postTokens', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-'));
  const filePath = path.join(dir, 'compact-boundary.jsonl');
  const lines = [
    JSON.stringify({ type: 'assistant', timestamp: '2024-01-01T00:00:01.000Z' }),
    JSON.stringify({
      type: 'system',
      subtype: 'compact_boundary',
      timestamp: '2024-01-01T00:05:00.000Z',
      compactMetadata: { trigger: 'auto', preTokens: 170574, postTokens: 7679 },
    }),
    JSON.stringify({ type: 'assistant', timestamp: '2024-01-01T00:06:00.000Z' }),
    // A second /compact later in the session should win.
    JSON.stringify({
      type: 'system',
      subtype: 'compact_boundary',
      timestamp: '2024-01-01T00:10:00.000Z',
      compactMetadata: { trigger: 'manual', preTokens: 180000, postTokens: 12345 },
    }),
  ];

  await writeFile(filePath, lines.join('\n'), 'utf8');

  try {
    const result = await parseTranscript(filePath);
    assert.equal(result.lastCompactBoundaryAt?.toISOString(), '2024-01-01T00:10:00.000Z');
    assert.equal(result.lastCompactPostTokens, 12345);
    assert.equal(result.compactionCount, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('parseTranscript ignores compact_boundary entries without a valid timestamp', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-'));
  const filePath = path.join(dir, 'compact-boundary-bad.jsonl');
  const lines = [
    JSON.stringify({
      type: 'system',
      subtype: 'compact_boundary',
      timestamp: 'not-a-date',
      compactMetadata: { postTokens: 500 },
    }),
    JSON.stringify({
      type: 'system',
      subtype: 'something_else',
      timestamp: '2024-01-01T00:05:00.000Z',
      compactMetadata: { postTokens: 999 },
    }),
  ];

  await writeFile(filePath, lines.join('\n'), 'utf8');

  try {
    const result = await parseTranscript(filePath);
    assert.equal(result.lastCompactBoundaryAt, undefined);
    assert.equal(result.lastCompactPostTokens, undefined);
    assert.equal(result.compactionCount, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('parseTranscript captures the last assistant response timestamp', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-'));
  const filePath = path.join(dir, 'assistant-timestamp.jsonl');
  const lines = [
    JSON.stringify({ type: 'assistant', timestamp: '2024-01-01T00:00:05.000Z' }),
    JSON.stringify({ type: 'user', timestamp: '2024-01-01T00:00:06.000Z' }),
    JSON.stringify({ type: 'assistant', timestamp: '2024-01-01T00:00:10.000Z' }),
    JSON.stringify({ type: 'assistant', timestamp: 'not-a-date' }),
  ];

  await writeFile(filePath, lines.join('\n'), 'utf8');

  try {
    const result = await parseTranscript(filePath);
    assert.equal(result.lastAssistantResponseAt?.toISOString(), '2024-01-01T00:00:10.000Z');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Prompt cache clock
// ---------------------------------------------------------------------------

/** Assistant record carrying a cache write on the given tier. */
function cacheWrite(fields, tier) {
  const cache_creation = tier === '1h'
    ? { ephemeral_1h_input_tokens: 1128, ephemeral_5m_input_tokens: 0 }
    : tier === '5m'
      ? { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 1128 }
      : tier;
  return {
    type: 'assistant',
    ...fields,
    message: { usage: { input_tokens: 4, output_tokens: 8, cache_creation } },
  };
}

const ULTRA_ENTER = { type: 'attachment', attachment: { type: 'ultra_effort_enter' } };
const ULTRA_EXIT = { type: 'attachment', attachment: { type: 'ultra_effort_exit' } };
const effortCmd = (level) => ({
  type: 'user',
  message: { content: `<local-command-stdout>Set effort level to ${level} (this session only): x</local-command-stdout>` },
});

test('parseTranscript reads ultracode attachment and /effort signals from a realistic transcript fixture', async () => {
  const fixturePath = fileURLToPath(new URL('./fixtures/transcript-ultracode.jsonl', import.meta.url));
  const entries = (await readFile(fixturePath, 'utf8'))
    .trim()
    .split('\n')
    .map(line => JSON.parse(line));

  const afterAttachment = await parseTempTranscript('ultra-fixture-enter.jsonl', entries.slice(0, 1));
  assert.equal(afterAttachment.ultracodeActive, true);

  const afterXhigh = await parseTempTranscript('ultra-fixture-xhigh.jsonl', entries.slice(0, 2));
  assert.equal(afterXhigh.ultracodeActive, false);

  const afterUltracode = await parseTempTranscript('ultra-fixture-active.jsonl', entries);
  assert.equal(afterUltracode.ultracodeActive, true);
});

test('parseTranscript: no ultracode signal leaves ultracodeActive undefined', async () => {
  const result = await parseTempTranscript('ultra-none.jsonl', [{ type: 'user', message: { content: 'hi' } }]);
  assert.equal(result.ultracodeActive, undefined);
});

test('parseTranscript: ultracode active from an enter attachment alone', async () => {
  const result = await parseTempTranscript('ultra-enter-only.jsonl', [ULTRA_ENTER]);
  assert.equal(result.ultracodeActive, true);
});

test('parseTranscript: enter then exit attachment clears ultracode', async () => {
  const result = await parseTempTranscript('ultra-exit.jsonl', [ULTRA_ENTER, ULTRA_EXIT]);
  assert.equal(result.ultracodeActive, false);
});

test('parseTranscript: runtime /effort ultracode is active', async () => {
  const result = await parseTempTranscript('ultra-cmd.jsonl', [effortCmd('high'), effortCmd('ultracode')]);
  assert.equal(result.ultracodeActive, true);
});

test('parseTranscript: /effort xhigh clears a stale enter marker before the exit attachment lands (regression)', async () => {
  // The exit attachment lags a turn behind a runtime /effort change, so the
  // immediate /effort output must clear the label during that lag window.
  const result = await parseTempTranscript('ultra-lag.jsonl', [ULTRA_ENTER, effortCmd('xhigh')]);
  assert.equal(result.ultracodeActive, false);
});

test('parseTranscript: the latest effort signal wins regardless of kind', async () => {
  const exitThenCmd = await parseTempTranscript('ultra-order-a.jsonl', [ULTRA_EXIT, effortCmd('ultracode')]);
  assert.equal(exitThenCmd.ultracodeActive, true);
  const cmdThenExit = await parseTempTranscript('ultra-order-b.jsonl', [effortCmd('ultracode'), ULTRA_EXIT]);
  assert.equal(cmdThenExit.ultracodeActive, false);
});

test('parseTranscript: a quoted /effort phrase mid-message does not flip ultracode (regression)', async () => {
  // Prose that merely quotes the command output (tag not at the start of the
  // record) must not be mistaken for a real /effort record.
  const quoted = {
    type: 'user',
    message: { content: 'I will run /effort. <local-command-stdout>Set effort level to ultracode (this session only): x</local-command-stdout>' },
  };
  const result = await parseTempTranscript('ultra-quoted.jsonl', [ULTRA_EXIT, quoted]);
  assert.equal(result.ultracodeActive, false);
});

test('parseTranscript: marker text in prose does not trigger ultracode (pollution guard)', async () => {
  // Ordinary conversation arrives as an array of text blocks, never a raw
  // string, so prose mentioning the marker must not match.
  const prose = await parseTempTranscript('ultra-prose.jsonl', [
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Run /effort then "Set effort level to ultracode".' }] } },
  ]);
  assert.equal(prose.ultracodeActive, undefined);
  // A string that merely contains the command wrapper (not at the start) must
  // not match either — the regex is anchored to the start of the stdout block.
  const quoted = await parseTempTranscript('ultra-quoted.jsonl', [
    { type: 'user', message: { content: 'I pasted: <local-command-stdout>Set effort level to ultracode</local-command-stdout>' } },
  ]);
  assert.equal(quoted.ultracodeActive, undefined);
});

test('parseTranscript ignores malformed session token values', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-'));
  const filePath = path.join(dir, 'session-tokens-malformed.jsonl');
  const lines = [
    JSON.stringify({
      type: 'assistant',
      message: {
        usage: {
          input_tokens: '1200',
          output_tokens: -50,
          cache_creation_input_tokens: 12.9,
          cache_read_input_tokens: null,
        },
      },
    }),
    JSON.stringify({
      type: 'assistant',
      message: {
        usage: {
          input_tokens: 5,
          output_tokens: 2,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 1,
        },
      },
    }),
  ];

  await writeFile(filePath, lines.join('\n'), 'utf8');

  try {
    const result = await parseTranscript(filePath);
    assert.deepEqual(result.sessionTokens, {
      inputTokens: 5,
      outputTokens: 2,
      cacheCreationTokens: 12,
      cacheReadTokens: 1,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('TaskCreate taskId is preserved across TodoWrite and usable by TaskUpdate', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-'));
  const filePath = path.join(dir, 'taskid-preserve.jsonl');
  const lines = [
    JSON.stringify({
      timestamp: '2024-01-01T00:00:00.000Z',
      message: { content: [{ type: 'tool_use', id: 'tc-1', name: 'TaskCreate', input: { taskId: 'alpha', subject: 'Build feature' } }] },
    }),
    JSON.stringify({
      timestamp: '2024-01-01T00:00:01.000Z',
      message: { content: [{ type: 'tool_use', id: 'tw-1', name: 'TodoWrite', input: { todos: [
        { content: 'Build feature', status: 'in_progress' },
        { content: 'Write tests', status: 'pending' },
      ] } }] },
    }),
    JSON.stringify({
      timestamp: '2024-01-01T00:00:02.000Z',
      message: { content: [{ type: 'tool_use', id: 'tu-1', name: 'TaskUpdate', input: { taskId: 'alpha', status: 'completed' } }] },
    }),
  ];

  await writeFile(filePath, lines.join('\n'), 'utf8');

  try {
    const result = await parseTranscript(filePath);
    assert.equal(result.todos.length, 2);
    assert.equal(result.todos[0].content, 'Build feature');
    assert.equal(result.todos[0].status, 'completed', 'TaskUpdate via preserved taskId should mark todo completed');
    assert.equal(result.todos[1].content, 'Write tests');
    assert.equal(result.todos[1].status, 'pending');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('TaskCreate taskIds survive TodoWrite when two todos share the same content', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-'));
  const filePath = path.join(dir, 'taskid-duplicate.jsonl');
  const lines = [
    JSON.stringify({
      timestamp: '2024-01-01T00:00:00.000Z',
      message: { content: [{ type: 'tool_use', id: 'tc-1', name: 'TaskCreate', input: { taskId: 'a1', subject: 'Duplicate task' } }] },
    }),
    JSON.stringify({
      timestamp: '2024-01-01T00:00:01.000Z',
      message: { content: [{ type: 'tool_use', id: 'tc-2', name: 'TaskCreate', input: { taskId: 'a2', subject: 'Duplicate task' } }] },
    }),
    JSON.stringify({
      timestamp: '2024-01-01T00:00:02.000Z',
      message: { content: [{ type: 'tool_use', id: 'tw-1', name: 'TodoWrite', input: { todos: [
        { content: 'Duplicate task', status: 'pending' },
        { content: 'Duplicate task', status: 'pending' },
      ] } }] },
    }),
    // Update the SECOND duplicate's taskId specifically.
    JSON.stringify({
      timestamp: '2024-01-01T00:00:03.000Z',
      message: { content: [{ type: 'tool_use', id: 'tu-1', name: 'TaskUpdate', input: { taskId: 'a2', status: 'completed' } }] },
    }),
  ];

  await writeFile(filePath, lines.join('\n'), 'utf8');

  try {
    const result = await parseTranscript(filePath);
    assert.equal(result.todos.length, 2);
    assert.equal(result.todos[0].content, 'Duplicate task');
    assert.equal(result.todos[0].status, 'pending',
      'first occurrence must remain pending when only the second was updated');
    assert.equal(result.todos[1].content, 'Duplicate task');
    assert.equal(result.todos[1].status, 'completed',
      'second occurrence must be reachable by its own taskId after TodoWrite');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('TodoWrite without prior TaskCreate works as before (no regression)', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-'));
  const filePath = path.join(dir, 'todowrite-only.jsonl');
  const lines = [
    JSON.stringify({
      timestamp: '2024-01-01T00:00:00.000Z',
      message: { content: [{ type: 'tool_use', id: 'tw-1', name: 'TodoWrite', input: { todos: [
        { content: 'Task A', status: 'completed' },
        { content: 'Task B', status: 'in_progress' },
      ] } }] },
    }),
    JSON.stringify({
      timestamp: '2024-01-01T00:00:01.000Z',
      message: { content: [{ type: 'tool_use', id: 'tw-2', name: 'TodoWrite', input: { todos: [
        { content: 'Task B', status: 'completed' },
        { content: 'Task C', status: 'pending' },
      ] } }] },
    }),
  ];

  await writeFile(filePath, lines.join('\n'), 'utf8');

  try {
    const result = await parseTranscript(filePath);
    assert.equal(result.todos.length, 2);
    assert.equal(result.todos[0].content, 'Task B');
    assert.equal(result.todos[0].status, 'completed');
    assert.equal(result.todos[1].content, 'Task C');
    assert.equal(result.todos[1].status, 'pending');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('parseTranscript returns empty result when file is missing', async () => {
  const result = await parseTranscript('/tmp/does-not-exist.jsonl');
  assert.equal(result.tools.length, 0);
  assert.equal(result.agents.length, 0);
  assert.equal(result.todos.length, 0);
});

test('parseTranscript tolerates malformed lines', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-'));
  const filePath = path.join(dir, 'malformed.jsonl');
  const lines = [
    '{"timestamp":"2024-01-01T00:00:00.000Z","message":{"content":[{"type":"tool_use","id":"tool-1","name":"Read"}]}}',
    '{not-json}',
    '{"message":{"content":[{"type":"tool_result","tool_use_id":"tool-1"}]}}',
    '',
  ];

  await writeFile(filePath, lines.join('\n'), 'utf8');

  try {
    const result = await parseTranscript(filePath);
    assert.equal(result.tools.length, 1);
    assert.equal(result.tools[0].status, 'completed');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('parseTranscript extracts tool targets for common tools', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-'));
  const filePath = path.join(dir, 'targets.jsonl');
  const lines = [
    JSON.stringify({
      message: {
        content: [
          { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'echo hello world' } },
          { type: 'tool_use', id: 'tool-2', name: 'Glob', input: { pattern: '**/*.ts' } },
          { type: 'tool_use', id: 'tool-3', name: 'Grep', input: { pattern: 'render' } },
        ],
      },
    }),
  ];

  await writeFile(filePath, lines.join('\n'), 'utf8');

  try {
    const result = await parseTranscript(filePath);
    const targets = new Map(result.tools.map((tool) => [tool.name, tool.target]));
    assert.equal(targets.get('Bash'), 'echo hello world');
    assert.equal(targets.get('Glob'), '**/*.ts');
    assert.equal(targets.get('Grep'), 'render');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('parseTranscript collapses multiline Bash targets before truncating', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-'));
  const filePath = path.join(dir, 'bash-multiline.jsonl');
  const lines = [
    JSON.stringify({
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'Bash',
            input: { command: 'ID=foo\nccusage session --json\t| jq .total' },
          },
          {
            type: 'tool_use',
            id: 'tool-2',
            name: 'Bash',
            input: { command: ' \n\t ' },
          },
        ],
      },
    }),
  ];

  await writeFile(filePath, lines.join('\n'), 'utf8');

  try {
    const result = await parseTranscript(filePath);
    assert.equal(result.tools.length, 2);
    assert.equal(result.tools[0].target, 'ID=foo ccusage session --json...');
    assert.equal(result.tools[1].target, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('parseTranscript extracts Skill tool target from non-empty input.skill', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-'));
  const filePath = path.join(dir, 'skill-target.jsonl');
  const lines = [
    JSON.stringify({
      message: {
        content: [
          { type: 'tool_use', id: 'tool-1', name: 'Skill', input: { skill: 'prd-development' } },
        ],
      },
    }),
  ];

  await writeFile(filePath, lines.join('\n'), 'utf8');

  try {
    const result = await parseTranscript(filePath);
    assert.equal(result.tools.length, 1);
    assert.equal(result.tools[0].name, 'Skill');
    assert.equal(result.tools[0].target, 'prd-development');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('parseTranscript leaves Skill target empty when input.skill is missing or invalid', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-'));
  const filePath = path.join(dir, 'skill-target-invalid.jsonl');
  const lines = [
    JSON.stringify({
      message: {
        content: [
          { type: 'tool_use', id: 'tool-1', name: 'Skill', input: {} },
          { type: 'tool_use', id: 'tool-2', name: 'Skill', input: { skill: 123 } },
          { type: 'tool_use', id: 'tool-3', name: 'Skill', input: { skill: '   ' } },
        ],
      },
    }),
  ];

  await writeFile(filePath, lines.join('\n'), 'utf8');

  try {
    const result = await parseTranscript(filePath);
    assert.equal(result.tools.length, 3);
    assert.deepEqual(result.tools.map((tool) => tool.target), [undefined, undefined, undefined]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('parseTranscript truncates long bash commands in targets', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-'));
  const filePath = path.join(dir, 'bash.jsonl');
  const longCommand = 'echo ' + 'x'.repeat(50);
  const lines = [
    JSON.stringify({
      message: {
        content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: longCommand } }],
      },
    }),
  ];

  await writeFile(filePath, lines.join('\n'), 'utf8');

  try {
    const result = await parseTranscript(filePath);
    assert.equal(result.tools.length, 1);
    assert.ok(result.tools[0].target?.endsWith('...'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('parseTranscript attributes MCP tool errors back to their server', async () => {
  const result = await parseTempTranscript('mcp-errors.jsonl', [
    {
      message: {
        content: [
          { type: 'tool_use', id: 'm1', name: 'mcp__github__create_pr', input: {} },
          { type: 'tool_use', id: 'm2', name: 'mcp__tenable__search_tools', input: {} },
          { type: 'tool_use', id: 'm3', name: 'mcp__github__list_prs', input: {} },
          { type: 'tool_result', tool_use_id: 'm1', is_error: true },
          { type: 'tool_result', tool_use_id: 'm2', is_error: true },
          { type: 'tool_result', tool_use_id: 'm3', is_error: false },
        ],
      },
    },
  ]);

  assert.deepEqual(result.mcpErrors, ['tenable']);
});

test('parseTranscript records no MCP errors when every MCP call succeeds', async () => {
  const result = await parseTempTranscript('mcp-clean.jsonl', [
    {
      message: {
        content: [
          { type: 'tool_use', id: 'm1', name: 'mcp__linear__list_issues', input: {} },
          { type: 'tool_result', tool_use_id: 'm1', is_error: false },
        ],
      },
    },
  ]);

  assert.deepEqual(result.mcpErrors, []);
});

test('parseTranscript sanitizes and bounds MCP error server names on first parse', async () => {
  const poisoned = `bad\x1b]8;;https://evil.test\x07link\x1b]8;;\x07\u202E${'x'.repeat(100)}`;
  const result = await parseTempTranscript('mcp-error-sanitized.jsonl', [{
    message: {
      content: [
        { type: 'tool_use', id: 'm1', name: `mcp__${poisoned}__run`, input: {} },
        { type: 'tool_result', tool_use_id: 'm1', is_error: true },
      ],
    },
  }]);

  assert.equal(result.mcpErrors.length, 1);
  assert.equal(result.mcpErrors[0].length, 64);
  assert.doesNotMatch(result.mcpErrors[0], /[\x1b\u202E]/u);
});

// A failing non-MCP tool must not be attributed to a server — the name has no
// mcp__<server>__<tool> shape to parse, and mislabelling one would point an
// investigation at the wrong subsystem.

test('parseTranscript ignores non-MCP tool errors for MCP attribution', async () => {
  const result = await parseTempTranscript('non-mcp-error.jsonl', [
    {
      message: {
        content: [
          { type: 'tool_use', id: 't1', name: 'Read', input: { path: '/nope' } },
          { type: 'tool_result', tool_use_id: 't1', is_error: true },
        ],
      },
    },
  ]);

  assert.deepEqual(result.mcpErrors, []);
});

test('parseTranscript handles edge-case lines and error statuses', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-'));
  const filePath = path.join(dir, 'edge-cases.jsonl');
  const lines = [
    '   ',
    JSON.stringify({ message: { content: 'not-an-array' } }),
    JSON.stringify({
      message: {
        content: [
          { type: 'tool_use', id: 'agent-1', name: 'Task', input: {} },
          { type: 'tool_use', id: 'tool-error', name: 'Read', input: { path: '/tmp/fallback.txt' } },
          { type: 'tool_result', tool_use_id: 'tool-error', is_error: true },
          { type: 'tool_result', tool_use_id: 'missing-tool' },
        ],
      },
    }),
  ];

  await writeFile(filePath, lines.join('\n'), 'utf8');

  try {
    const result = await parseTranscript(filePath);
    const errorTool = result.tools.find((tool) => tool.id === 'tool-error');
    assert.equal(errorTool?.status, 'error');
    assert.equal(errorTool?.target, '/tmp/fallback.txt');
    assert.equal(result.agents[0]?.type, 'agent');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('parseTranscript detects agents recorded with the Agent tool name', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-'));
  const filePath = path.join(dir, 'agent-tool-name.jsonl');
  const lines = [
    JSON.stringify({
      timestamp: '2024-01-01T00:00:00.000Z',
      message: {
        content: [
          { type: 'tool_use', id: 'agent-1', name: 'Agent', input: { subagent_type: 'Explore', model: 'haiku' } },
        ],
      },
    }),
    JSON.stringify({
      timestamp: '2024-01-01T00:00:01.000Z',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'agent-1', is_error: false },
        ],
      },
    }),
  ];

  await writeFile(filePath, lines.join('\n'), 'utf8');

  try {
    const result = await parseTranscript(filePath);
    assert.equal(result.agents.length, 1);
    assert.equal(result.agents[0]?.id, 'agent-1');
    assert.equal(result.agents[0]?.type, 'Explore');
    assert.equal(result.agents[0]?.model, 'haiku');
    assert.equal(result.agents[0]?.status, 'completed');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('parseTranscript keeps background agents running until queue completion', async () => {
  const result = await parseTempTranscript('background-agent-running.jsonl', [
    {
      timestamp: '2024-01-01T00:00:00.000Z',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'agent-bg',
            name: 'Task',
            input: { subagent_type: 'explore', run_in_background: true },
          },
        ],
      },
    },
    {
      timestamp: '2024-01-01T00:00:04.000Z',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'agent-bg', is_error: false },
        ],
      },
    },
  ]);

  assert.equal(result.agents.length, 1);
  assert.equal(result.agents[0].status, 'running');
  assert.equal(result.agents[0].endTime, undefined);
});

test('parseTranscript completes background agents from matching queue-operation timestamps', async () => {
  const result = await parseTempTranscript('background-agent-completed.jsonl', [
    {
      timestamp: '2024-01-01T00:00:00.000Z',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'agent-bg',
            name: 'Task',
            input: { subagent_type: 'explore', run_in_background: true },
          },
        ],
      },
    },
    {
      timestamp: '2024-01-01T00:00:04.000Z',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'agent-bg', is_error: false },
        ],
      },
    },
    {
      timestamp: '2024-01-01T00:01:17.000Z',
      type: 'queue-operation',
      operation: 'enqueue',
      content: '<task-id>task-1</task-id><tool-use-id>agent-bg</tool-use-id>',
    },
  ]);

  assert.equal(result.agents.length, 1);
  assert.equal(result.agents[0].status, 'completed');
  assert.equal(result.agents[0].endTime?.toISOString(), '2024-01-01T00:01:17.000Z');
});

test('parseTranscript leaves foreground agent timing on tool_result', async () => {
  const result = await parseTempTranscript('foreground-agent.jsonl', [
    {
      timestamp: '2024-01-01T00:00:00.000Z',
      message: {
        content: [
          { type: 'tool_use', id: 'agent-fg', name: 'Task', input: { subagent_type: 'explore' } },
        ],
      },
    },
    {
      timestamp: '2024-01-01T00:00:04.000Z',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'agent-fg', is_error: false },
        ],
      },
    },
    {
      timestamp: '2024-01-01T00:01:17.000Z',
      type: 'queue-operation',
      operation: 'enqueue',
      content: '<task-id>task-1</task-id><tool-use-id>agent-fg</tool-use-id>',
    },
  ]);

  assert.equal(result.agents.length, 1);
  assert.equal(result.agents[0].status, 'completed');
  assert.equal(result.agents[0].endTime?.toISOString(), '2024-01-01T00:00:04.000Z');
});

test('parseTranscript ignores malformed and unrelated queue-operation completions', async () => {
  const result = await parseTempTranscript('background-agent-forged.jsonl', [
    {
      timestamp: '2024-01-01T00:00:00.000Z',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'agent-bg',
            name: 'Task',
            input: { subagent_type: 'explore', run_in_background: true },
          },
        ],
      },
    },
    {
      timestamp: '2024-01-01T00:00:04.000Z',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'agent-bg', is_error: false },
        ],
      },
    },
    {
      timestamp: '2024-01-01T00:01:17.000Z',
      type: 'queue-operation',
      operation: 'enqueue',
      content: '<task-id>task-1</task-id>',
    },
    {
      timestamp: '2024-01-01T00:01:18.000Z',
      type: 'queue-operation',
      operation: 'enqueue',
      content: '<task-id>task-2</task-id><tool-use-id>other-agent</tool-use-id>',
    },
  ]);

  assert.equal(result.agents.length, 1);
  assert.equal(result.agents[0].status, 'running');
  assert.equal(result.agents[0].endTime, undefined);
});

test('parseTranscript returns undefined targets for unknown tools', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-'));
  const filePath = path.join(dir, 'unknown-tools.jsonl');
  const lines = [
    JSON.stringify({
      message: {
        content: [{ type: 'tool_use', id: 'tool-1', name: 'UnknownTool', input: { foo: 'bar' } }],
      },
    }),
  ];

  await writeFile(filePath, lines.join('\n'), 'utf8');

  try {
    const result = await parseTranscript(filePath);
    assert.equal(result.tools.length, 1);
    assert.equal(result.tools[0].target, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('parseTranscript returns partial results when stream creation fails', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-'));
  const transcriptDir = path.join(dir, 'transcript-dir');
  await mkdir(transcriptDir);

  try {
    const result = await parseTranscript(transcriptDir);
    assert.equal(result.tools.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('parseTranscript does not cache partial results when stream creation fails after file state lookup', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-transcript-cache-'));
  const configDir = path.join(dir, '.claude-test');
  const transcriptPath = path.join(dir, 'stream-failure.jsonl');
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const cacheDir = path.join(configDir, 'plugins', 'claude-hud', 'transcript-cache');

  process.env.CLAUDE_CONFIG_DIR = configDir;
  await writeFile(transcriptPath, '{"timestamp":"2024-01-01T00:00:00.000Z"}\n', 'utf8');
  _setCreateReadStreamForTests(() => {
    throw new Error('boom');
  });

  try {
    const result = await parseTranscript(transcriptPath);
    assert.equal(result.tools.length, 0);
    assert.equal(fs.existsSync(cacheDir), false);
  } finally {
    _setCreateReadStreamForTests(null);
    restoreEnvVar('CLAUDE_CONFIG_DIR', originalConfigDir);
    await rm(dir, { recursive: true, force: true });
  }
});

test('parseTranscript reuses cached data when transcript state is unchanged', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-transcript-cache-'));
  const configDir = path.join(dir, '.claude-test');
  const transcriptPath = path.join(dir, 'cache-hit.jsonl');
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const initialLine = `${JSON.stringify({
    timestamp: '2024-01-01T00:00:00.000Z',
    message: { content: [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: { path: '/tmp/original.txt' } }] },
  })}\n${JSON.stringify({
    type: 'system',
    subtype: 'compact_boundary',
    timestamp: '2024-01-01T00:05:00.000Z',
    compactMetadata: { trigger: 'auto', preTokens: 170574, postTokens: 7679 },
  })}\n`;

  process.env.CLAUDE_CONFIG_DIR = configDir;
  await writeFile(transcriptPath, initialLine, 'utf8');
  fs.utimesSync(transcriptPath, 1710000000, 1710000000);

  try {
    const first = await parseTranscript(transcriptPath);
    assert.equal(first.tools.length, 1);
    assert.equal(first.tools[0].target, '/tmp/original.txt');
    assert.equal(first.compactionCount, 1);

    const stat = fs.statSync(transcriptPath);
    const corrupted = '#'.repeat(stat.size);
    await writeFile(transcriptPath, corrupted, 'utf8');
    fs.utimesSync(transcriptPath, 1710000000, 1710000000);

    const second = await parseTranscript(transcriptPath);
    assert.equal(second.tools.length, 1);
    assert.equal(second.tools[0].target, '/tmp/original.txt');
    assert.equal(second.compactionCount, 1);
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', originalConfigDir);
    await rm(dir, { recursive: true, force: true });
  }
});

// mcpErrors must survive the transcript cache round-trip. The status line is
// invoked continuously and almost every invocation is a CACHE HIT, so a field
// that serializes but does not deserialize (or vice versa) is populated on the
// very first tick and silently empty for the rest of the session. The file is
// corrupted here while mtime+size are held constant, so a cache MISS would
// re-parse garbage and yield nothing — the assertion can only pass if the
// value genuinely round-tripped through the cache.

test('parseTranscript round-trips mcpErrors through the transcript cache', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-mcperr-cache-'));
  const configDir = path.join(dir, '.claude-test');
  const transcriptPath = path.join(dir, 'mcp-cache.jsonl');
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const line = `${JSON.stringify({
    timestamp: '2024-01-01T00:00:00.000Z',
    message: {
      content: [
        { type: 'tool_use', id: 'm1', name: 'mcp__airlock__block_hash', input: {} },
        { type: 'tool_result', tool_use_id: 'm1', is_error: true },
      ],
    },
  })}\n`;

  process.env.CLAUDE_CONFIG_DIR = configDir;
  await writeFile(transcriptPath, line, 'utf8');
  fs.utimesSync(transcriptPath, 1710000000, 1710000000);

  try {
    const first = await parseTranscript(transcriptPath);
    assert.deepEqual(first.mcpErrors, ['airlock'], 'first parse should attribute the error');

    // Same mtime and size, different bytes: only a cache hit can still answer.
    const stat = fs.statSync(transcriptPath);
    await writeFile(transcriptPath, '#'.repeat(stat.size), 'utf8');
    fs.utimesSync(transcriptPath, 1710000000, 1710000000);

    const second = await parseTranscript(transcriptPath);
    assert.deepEqual(second.mcpErrors, ['airlock'],
      'mcpErrors must survive the cache round-trip, not just the first parse');
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', originalConfigDir);
    await rm(dir, { recursive: true, force: true });
  }
});

test('parseTranscript sanitizes and caps a poisoned cached model ID', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-transcript-cache-'));
  const configDir = path.join(dir, '.claude-test');
  const transcriptPath = path.join(dir, 'cache-model-poison.jsonl');
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const line = `${JSON.stringify({
    type: 'assistant',
    message: { model: 'safe-model' },
  })}\n`;
  const malicious = `cache-\x1b[31mred\x1b[0m\x1b]8;;https://evil.test\x07link\x1b]8;;\x07\u202E${'x'.repeat(100)}`;

  process.env.CLAUDE_CONFIG_DIR = configDir;
  await writeFile(transcriptPath, line, 'utf8');

  try {
    const first = await parseTranscript(transcriptPath);
    assert.equal(first.lastAssistantModel, 'safe-model');

    const cachePath = await getTranscriptCacheFile(configDir);
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    cache.data.lastAssistantModel = malicious;
    await writeFile(cachePath, JSON.stringify(cache), 'utf8');

    const second = await parseTranscript(transcriptPath);
    assert.ok(second.lastAssistantModel?.startsWith('cache-redlink'));
    assert.equal(second.lastAssistantModel?.length, 80);
    assert.doesNotMatch(second.lastAssistantModel ?? '', /[\x1b\u202E]/u);
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', originalConfigDir);
    await rm(dir, { recursive: true, force: true });
  }
});

test('parseTranscript invalidates cached data when transcript state changes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-transcript-cache-'));
  const configDir = path.join(dir, '.claude-test');
  const transcriptPath = path.join(dir, 'cache-invalidate.jsonl');
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const initialLine = `${JSON.stringify({
    timestamp: '2024-01-01T00:00:00.000Z',
    message: { content: [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: { path: '/tmp/original.txt' } }] },
  })}\n`;
  const updatedLine = `${JSON.stringify({
    timestamp: '2024-01-01T00:05:00.000Z',
    message: { content: [{ type: 'tool_use', id: 'tool-2', name: 'Read', input: { path: '/tmp/updated.txt' } }] },
  })}\n`;

  process.env.CLAUDE_CONFIG_DIR = configDir;
  await writeFile(transcriptPath, initialLine, 'utf8');
  fs.utimesSync(transcriptPath, 1710000100, 1710000100);

  try {
    const first = await parseTranscript(transcriptPath);
    assert.equal(first.tools[0].target, '/tmp/original.txt');

    const stat = fs.statSync(transcriptPath);
    await writeFile(transcriptPath, updatedLine, 'utf8');
    fs.utimesSync(transcriptPath, 1710000101, 1710000101);

    const second = await parseTranscript(transcriptPath);
    assert.equal(second.tools.length, 1);
    assert.equal(second.tools[0].target, '/tmp/updated.txt');
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', originalConfigDir);
    await rm(dir, { recursive: true, force: true });
  }
});

test('parseTranscript falls back to a fresh parse when the transcript cache is corrupted', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-transcript-cache-'));
  const configDir = path.join(dir, '.claude-test');
  const transcriptPath = path.join(dir, 'cache-corrupt.jsonl');
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const line = `${JSON.stringify({
    timestamp: '2024-01-01T00:00:00.000Z',
    message: { content: [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: { path: '/tmp/original.txt' } }] },
  })}\n`;

  process.env.CLAUDE_CONFIG_DIR = configDir;
  await writeFile(transcriptPath, line, 'utf8');

  try {
    const first = await parseTranscript(transcriptPath);
    assert.equal(first.tools[0].target, '/tmp/original.txt');

    const cachePath = await getTranscriptCacheFile(configDir);
    await writeFile(cachePath, '{not-json}', 'utf8');

    const second = await parseTranscript(transcriptPath);
    assert.equal(second.tools.length, 1);
    assert.equal(second.tools[0].target, '/tmp/original.txt');
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', originalConfigDir);
    await rm(dir, { recursive: true, force: true });
  }
});

test('parseTranscript invalidates transcript cache entries from older cache versions', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-transcript-cache-'));
  const configDir = path.join(dir, '.claude-test');
  const transcriptPath = path.join(dir, 'cache-version-upgrade.jsonl');
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const line = `${JSON.stringify({
    type: 'assistant',
    timestamp: '2024-01-01T00:00:00.000Z',
    message: { content: [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: { path: '/tmp/fresh.txt' } }] },
  })}\n`;

  process.env.CLAUDE_CONFIG_DIR = configDir;
  await writeFile(transcriptPath, line, 'utf8');
  fs.utimesSync(transcriptPath, 1710000200, 1710000200);

  try {
    const stat = fs.statSync(transcriptPath);
    const cachePath = path.join(
      configDir,
      'plugins',
      'claude-hud',
      'transcript-cache',
      `${createHash('sha256').update(path.resolve(transcriptPath)).digest('hex')}.json`
    );
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cachePath, JSON.stringify({
      transcriptPath: path.resolve(transcriptPath),
      transcriptState: { mtimeMs: stat.mtimeMs, size: stat.size },
      data: {
        tools: [],
        agents: [],
        todos: [],
        sessionName: 'stale-cache',
      },
    }), 'utf8');

    const result = await parseTranscript(transcriptPath);
    assert.equal(result.sessionName, undefined);
    assert.equal(result.tools.length, 1);
    assert.equal(result.lastAssistantResponseAt?.toISOString(), '2024-01-01T00:00:00.000Z');
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', originalConfigDir);
    await rm(dir, { recursive: true, force: true });
  }
});

test('parseTranscript captures advisorModel from assistant records', async () => {
  const result = await parseTempTranscript('advisor.jsonl', [
    { type: 'user', slug: 'auto-slug' },
    {
      type: 'assistant',
      timestamp: '2026-05-28T09:03:32.094Z',
      advisorModel: 'claude-opus-4-7',
      message: { content: [] },
    },
  ]);

  assert.equal(result.advisorModel, 'claude-opus-4-7');
});

test('parseTranscript returns undefined advisorModel when not present', async () => {
  const result = await parseTempTranscript('no-advisor.jsonl', [
    { type: 'user', slug: 'auto-slug' },
    { type: 'assistant', timestamp: '2026-05-28T09:03:32.094Z', message: { content: [] } },
  ]);

  assert.equal(result.advisorModel, undefined);
});

test('parseTranscript prefers the most recent advisorModel value', async () => {
  const result = await parseTempTranscript('advisor-latest.jsonl', [
    {
      type: 'assistant',
      timestamp: '2026-05-28T09:00:00.000Z',
      advisorModel: 'claude-sonnet-4-6',
      message: { content: [] },
    },
    {
      type: 'assistant',
      timestamp: '2026-05-28T09:05:00.000Z',
      advisorModel: 'claude-opus-4-7',
      message: { content: [] },
    },
  ]);

  assert.equal(result.advisorModel, 'claude-opus-4-7');
});

test('parseTranscript ignores empty advisorModel strings', async () => {
  const result = await parseTempTranscript('advisor-empty.jsonl', [
    {
      type: 'assistant',
      timestamp: '2026-05-28T09:00:00.000Z',
      advisorModel: '',
      message: { content: [] },
    },
  ]);

  assert.equal(result.advisorModel, undefined);
});

test('parseTranscript ignores advisorModel on non-assistant records', async () => {
  // Per Claude Code's documented schema the field is only meaningful on
  // assistant records; reading it from user / custom-title / system records
  // would let a malformed log poison the value.
  const result = await parseTempTranscript('advisor-non-assistant.jsonl', [
    {
      type: 'user',
      timestamp: '2026-05-28T09:00:00.000Z',
      advisorModel: 'claude-sonnet-4-6',
    },
    {
      type: 'custom-title',
      customTitle: 'My Session',
      advisorModel: 'claude-haiku-4-5',
    },
    {
      type: 'system',
      subtype: 'compact_boundary',
      advisorModel: 'claude-haiku-4-5',
    },
  ]);

  assert.equal(result.advisorModel, undefined);
});

test('parseTranscript caps oversized advisorModel at the transcript length limit', async () => {
  const result = await parseTempTranscript('advisor-oversized.jsonl', [
    {
      type: 'assistant',
      timestamp: '2026-05-28T09:00:00.000Z',
      advisorModel: 'claude-' + 'x'.repeat(500),
      message: { content: [] },
    },
  ]);

  assert.ok(
    typeof result.advisorModel === 'string' && result.advisorModel.length <= 64,
    `expected capped advisorModel, got length ${result.advisorModel?.length}`,
  );
});

function agentLaunchEntries(toolUseId, input, toolUseResult) {
  const entries = [
    {
      timestamp: '2026-07-19T10:00:00.000Z',
      message: {
        content: [
          { type: 'tool_use', id: toolUseId, name: 'Agent', input },
        ],
      },
    },
    {
      timestamp: '2026-07-19T10:00:00.040Z',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: toolUseId, content: 'launched' },
        ],
      },
    },
  ];
  if (toolUseResult) {
    entries[1].toolUseResult = toolUseResult;
  }
  return entries;
}

test('parseTranscript treats async_launched Agent results as background', async () => {
  const result = await parseTempTranscript(
    'agent-async-launched.jsonl',
    agentLaunchEntries(
      'agent-async',
      { subagent_type: 'claude', description: 'long run', model: 'opus' },
      { status: 'async_launched', isAsync: true, resolvedModel: 'claude-opus-5[1m]' },
    ),
  );

  assert.equal(result.agents.length, 1);
  assert.equal(result.agents[0]?.status, 'running');
  assert.equal(result.agents[0]?.background, true);
  assert.equal(result.agents[0]?.endTime, undefined);
});

test('parseTranscript completes async-launched agents from the task-notification timestamp', async () => {
  const result = await parseTempTranscript('agent-async-completed.jsonl', [
    ...agentLaunchEntries(
      'agent-async-done',
      { subagent_type: 'claude', description: 'long run' },
      { status: 'async_launched', isAsync: true },
    ),
    {
      timestamp: '2026-07-19T11:00:00.000Z',
      type: 'queue-operation',
      operation: 'enqueue',
      content: '<task-id>aa21d445</task-id><tool-use-id>agent-async-done</tool-use-id>',
    },
  ]);

  assert.equal(result.agents[0]?.status, 'completed');
  assert.equal(result.agents[0]?.endTime?.toISOString(), '2026-07-19T11:00:00.000Z');
});

test('parseTranscript reads the agent model from toolUseResult.resolvedModel', async () => {
  const result = await parseTempTranscript(
    'agent-resolved-model.jsonl',
    agentLaunchEntries(
      'agent-resolved',
      { subagent_type: 'general-purpose', description: 'inherits the session model' },
      { status: 'async_launched', isAsync: true, resolvedModel: 'claude-sonnet-5[1m]' },
    ),
  );

  assert.equal(result.agents.length, 1);
  assert.equal(result.agents[0]?.model, 'claude-sonnet-5[1m]');
});

test('parseTranscript prefers resolvedModel over the model passed by the caller', async () => {
  const result = await parseTempTranscript(
    'agent-resolved-wins.jsonl',
    agentLaunchEntries(
      'agent-both',
      { subagent_type: 'Explore', model: 'opus' },
      { status: 'completed', resolvedModel: 'claude-opus-4-8[1m]' },
    ),
  );

  assert.equal(result.agents[0]?.model, 'claude-opus-4-8[1m]');
});

test('parseTranscript keeps the caller model when no resolvedModel is reported', async () => {
  const result = await parseTempTranscript(
    'agent-no-resolved.jsonl',
    agentLaunchEntries('agent-alias', { subagent_type: 'Explore', model: 'haiku' }, null),
  );

  assert.equal(result.agents[0]?.model, 'haiku');
});

test('parseTranscript leaves the agent model unset when neither source reports one', async () => {
  const result = await parseTempTranscript(
    'agent-no-model.jsonl',
    agentLaunchEntries('agent-none', { subagent_type: 'Explore' }, { status: 'completed' }),
  );

  assert.equal(result.agents[0]?.model, undefined);
});

test('parseTranscript caps an oversized resolvedModel at the model length limit', async () => {
  const result = await parseTempTranscript(
    'agent-oversized-model.jsonl',
    agentLaunchEntries(
      'agent-oversized',
      { subagent_type: 'Explore' },
      { status: 'completed', resolvedModel: 'claude-' + 'x'.repeat(500) },
    ),
  );

  assert.ok(
    typeof result.agents[0]?.model === 'string'
      && result.agents[0].model.length <= TRANSCRIPT_MODEL_MAX_LEN,
    `expected capped agent model, got length ${result.agents[0]?.model?.length}`,
  );
});

test('parseTranscript strips terminal escapes from resolvedModel', async () => {
  const result = await parseTempTranscript(
    'agent-escape-model.jsonl',
    agentLaunchEntries(
      'agent-escape',
      { subagent_type: 'Explore' },
      { status: 'completed', resolvedModel: '\u001b[31mclaude-opus-4-8\u001b[0m' },
    ),
  );

  assert.equal(result.agents[0]?.model, 'claude-opus-4-8');
});

test('parseTranscript ignores a non-string resolvedModel', async () => {
  const result = await parseTempTranscript(
    'agent-bad-model.jsonl',
    agentLaunchEntries(
      'agent-bad',
      { subagent_type: 'Explore', model: 'sonnet' },
      { status: 'completed', resolvedModel: { id: 'claude-opus-4-8' } },
    ),
  );

  assert.equal(result.agents[0]?.model, 'sonnet');
});
