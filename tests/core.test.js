import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTranscript } from '../dist/transcript.js';
import { countConfigs } from '../dist/config-reader.js';
import { getContextPercent, getModelName } from '../dist/stdin.js';
import * as fs from 'node:fs';

test('getContextPercent returns 0 when data is missing', () => {
  assert.equal(getContextPercent({}), 0);
  assert.equal(getContextPercent({ context_window: { context_window_size: 0 } }), 0);
});

test('getContextPercent includes cache tokens and autocompact buffer', () => {
  // For 50%: tokens/size + 22.5% = 50% → tokens/size = 27.5% → tokens = 55000
  const percent = getContextPercent({
    context_window: {
      context_window_size: 200000,
      current_usage: {
        input_tokens: 30000,
        cache_creation_input_tokens: 12500,
        cache_read_input_tokens: 12500,
      },
    },
  });

  assert.equal(percent, 50);
});

test('getContextPercent handles missing input tokens', () => {
  // For 25%: tokens/size + 22.5% = 25% → tokens/size = 2.5% → tokens = 5000
  const percent = getContextPercent({
    context_window: {
      context_window_size: 200000,
      current_usage: {
        cache_creation_input_tokens: 3000,
        cache_read_input_tokens: 2000,
      },
    },
  });

  assert.equal(percent, 25);
});

test('getContextPercent matches /context output across different window sizes', () => {
  // The HUD should match /context by using a dynamic 22.5% buffer based on window size
  // Formula: percentage = (tokens + size * 0.225) / size * 100 = tokens/size * 100 + 22.5

  // Test case 1: 200k window with 45k tokens → should be 45% (same as before)
  assert.equal(
    getContextPercent({
      context_window: {
        context_window_size: 200000,
        current_usage: { input_tokens: 45000 },
      },
    }),
    45,
    '200k window: 45k tokens should equal 45%'
  );

  // Test case 2: 1M window with 45k tokens → should be ~27% (was incorrectly 9% with hardcoded buffer)
  assert.equal(
    getContextPercent({
      context_window: {
        context_window_size: 1000000,
        current_usage: { input_tokens: 45000 },
      },
    }),
    27,
    '1M window: 45k tokens should equal 27% (not 9%)'
  );

  // Test case 3: 500k window with 67.5k tokens → should be ~36% (was incorrectly 23% with hardcoded buffer)
  assert.equal(
    getContextPercent({
      context_window: {
        context_window_size: 500000,
        current_usage: { input_tokens: 67500 },
      },
    }),
    36,
    '500k window: 67.5k tokens should equal 36% (not 23%)'
  );

  // Test case 4: Verify the 22.5% buffer is always applied regardless of window size
  // With 0 tokens, percentage should always be 23% (rounded from 22.5%)
  assert.equal(
    getContextPercent({
      context_window: {
        context_window_size: 200000,
        current_usage: { input_tokens: 0 },
      },
    }),
    23,
    '200k window: 0 tokens should equal 23% (buffer only)'
  );

  assert.equal(
    getContextPercent({
      context_window: {
        context_window_size: 1000000,
        current_usage: { input_tokens: 0 },
      },
    }),
    23,
    '1M window: 0 tokens should equal 23% (buffer only)'
  );
});

test('getModelName prefers display name, then id, then fallback', () => {
  assert.equal(getModelName({ model: { display_name: 'Opus', id: 'opus-123' } }), 'Opus');
  assert.equal(getModelName({ model: { id: 'sonnet-456' } }), 'sonnet-456');
  assert.equal(getModelName({}), 'Unknown');
});

test('parseTranscript aggregates tools, agents, and todos', async () => {
  const fixturePath = fileURLToPath(new URL('./fixtures/transcript-basic.jsonl', import.meta.url));
  const result = await parseTranscript(fixturePath);
  assert.equal(result.tools.length, 1);
  assert.equal(result.tools[0].status, 'completed');
  assert.equal(result.tools[0].target, '/tmp/example.txt');
  assert.equal(result.agents.length, 1);
  assert.equal(result.agents[0].status, 'completed');
  assert.equal(result.todos.length, 2);
  assert.equal(result.todos[1].status, 'in_progress');
  assert.equal(result.sessionStart?.toISOString(), '2024-01-01T00:00:00.000Z');
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
    assert.equal(result.agents[0]?.type, 'unknown');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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

test('countConfigs honors project and global config locations', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-home-'));
  const projectDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-project-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;

  try {
    await mkdir(path.join(homeDir, '.claude', 'rules', 'nested'), { recursive: true });
    await writeFile(path.join(homeDir, '.claude', 'CLAUDE.md'), 'global', 'utf8');
    await writeFile(path.join(homeDir, '.claude', 'rules', 'rule.md'), '# rule', 'utf8');
    await writeFile(path.join(homeDir, '.claude', 'rules', 'nested', 'rule-nested.md'), '# rule nested', 'utf8');
    await writeFile(
      path.join(homeDir, '.claude', 'settings.json'),
      JSON.stringify({ mcpServers: { one: {} }, hooks: { onStart: {} } }),
      'utf8'
    );
    await writeFile(path.join(homeDir, '.claude.json'), '{bad json', 'utf8');

    await mkdir(path.join(projectDir, '.claude', 'rules'), { recursive: true });
    await writeFile(path.join(projectDir, 'CLAUDE.md'), 'project', 'utf8');
    await writeFile(path.join(projectDir, 'CLAUDE.local.md'), 'project-local', 'utf8');
    await writeFile(path.join(projectDir, '.claude', 'CLAUDE.md'), 'project-alt', 'utf8');
    await writeFile(path.join(projectDir, '.claude', 'CLAUDE.local.md'), 'project-alt-local', 'utf8');
    await writeFile(path.join(projectDir, '.claude', 'rules', 'rule2.md'), '# rule2', 'utf8');
    await writeFile(
      path.join(projectDir, '.claude', 'settings.json'),
      JSON.stringify({ mcpServers: { two: {}, three: {} }, hooks: { onStop: {} } }),
      'utf8'
    );
    await writeFile(path.join(projectDir, '.claude', 'settings.local.json'), '{bad json', 'utf8');
    await writeFile(path.join(projectDir, '.mcp.json'), JSON.stringify({ mcpServers: { four: {} } }), 'utf8');

    const counts = await countConfigs(projectDir);
    assert.equal(counts.claudeMdCount, 5);
    assert.equal(counts.rulesCount, 3);
    assert.equal(counts.mcpCount, 4);
    assert.equal(counts.hooksCount, 2);
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  }
});

test('countConfigs tolerates rule directory read errors', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-home-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;

  const rulesDir = path.join(homeDir, '.claude', 'rules');
  await mkdir(rulesDir, { recursive: true });
  fs.chmodSync(rulesDir, 0);

  try {
    const counts = await countConfigs();
    assert.equal(counts.rulesCount, 0);
  } finally {
    fs.chmodSync(rulesDir, 0o755);
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
  }
});
