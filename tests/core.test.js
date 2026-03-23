import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _setCreateReadStreamForTests, parseTranscript } from '../dist/transcript.js';
import { countConfigs } from '../dist/config-reader.js';
import { getContextPercent, getBufferedPercent, getModelName, getProviderLabel, getUsageFromStdin, isBedrockModelId } from '../dist/stdin.js';
import * as fs from 'node:fs';

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

test('getContextPercent returns 0 when data is missing', () => {
  assert.equal(getContextPercent({}), 0);
  assert.equal(getContextPercent({ context_window: { context_window_size: 0 } }), 0);
  assert.equal(getBufferedPercent({}), 0);
  assert.equal(getBufferedPercent({ context_window: { context_window_size: 0 } }), 0);
});

test('getContextPercent returns raw percentage without buffer', () => {
  // 55000 / 200000 = 27.5% → rounds to 28%
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

  assert.equal(percent, 28);
});

test('getBufferedPercent scales buffer by raw usage', () => {
  // 55000 / 200000 = 27.5% raw, scale = (0.275 - 0.05) / (0.50 - 0.05) = 0.5
  // buffer = 200000 * 0.165 * 0.5 = 16500, (55000 + 16500) / 200000 = 35.75% → 36%
  const percent = getBufferedPercent({
    context_window: {
      context_window_size: 200000,
      current_usage: {
        input_tokens: 30000,
        cache_creation_input_tokens: 12500,
        cache_read_input_tokens: 12500,
      },
    },
  });

  assert.equal(percent, 36);
});

test('getContextPercent handles missing input tokens', () => {
  // 5000 / 200000 = 2.5% → rounds to 3%
  const percent = getContextPercent({
    context_window: {
      context_window_size: 200000,
      current_usage: {
        cache_creation_input_tokens: 3000,
        cache_read_input_tokens: 2000,
      },
    },
  });

  assert.equal(percent, 3);
});

test('getBufferedPercent applies no buffer at very low usage', () => {
  // 1M window, 45000 tokens = 4.5% raw → below 5% threshold → scale = 0 → no buffer
  const rawPercent = getContextPercent({
    context_window: {
      context_window_size: 1000000,
      current_usage: { input_tokens: 45000 },
    },
  });
  const bufferedPercent = getBufferedPercent({
    context_window: {
      context_window_size: 1000000,
      current_usage: { input_tokens: 45000 },
    },
  });

  assert.equal(rawPercent, 5);
  assert.equal(bufferedPercent, 5); // no buffer at low usage (e.g. after /clear)
});

test('getBufferedPercent returns 0 for startup state before usage exists', () => {
  const percent = getBufferedPercent({
    context_window: {
      context_window_size: 200000,
      current_usage: {},
      used_percentage: null,
    },
  });

  assert.equal(percent, 0);
});

test('getBufferedPercent applies full buffer at high usage', () => {
  // 200k window, 110000 tokens = 55% raw → above 50% threshold → scale = 1 → full buffer
  // buffer = 200000 * 0.165 = 33000, (110000 + 33000) / 200000 = 71.5% → 72%
  const percent = getBufferedPercent({
    context_window: {
      context_window_size: 200000,
      current_usage: { input_tokens: 110000 },
    },
  });

  assert.equal(percent, 72);
});

// Native percentage tests (Claude Code v2.1.6+)
test('getContextPercent prefers native used_percentage when available', () => {
  const percent = getContextPercent({
    context_window: {
      context_window_size: 200000,
      current_usage: { input_tokens: 55000 }, // would be 28% raw
      used_percentage: 47, // native value takes precedence
    },
  });
  assert.equal(percent, 47);
});

test('getBufferedPercent prefers native used_percentage when available', () => {
  const percent = getBufferedPercent({
    context_window: {
      context_window_size: 200000,
      current_usage: { input_tokens: 55000 }, // would be 44% buffered
      used_percentage: 47, // native value takes precedence
    },
  });
  assert.equal(percent, 47);
});

test('getBufferedPercent switches from startup fallback to native percentage when available', () => {
  const startupPercent = getBufferedPercent({
    context_window: {
      context_window_size: 200000,
      current_usage: {},
      used_percentage: null,
    },
  });
  const nativePercent = getBufferedPercent({
    context_window: {
      context_window_size: 200000,
      current_usage: { input_tokens: 1000 },
      used_percentage: 1,
    },
  });

  assert.equal(startupPercent, 0);
  assert.equal(nativePercent, 1);
});

test('getContextPercent falls back when native is null', () => {
  const percent = getContextPercent({
    context_window: {
      context_window_size: 200000,
      current_usage: { input_tokens: 55000 },
      used_percentage: null,
    },
  });
  assert.equal(percent, 28); // raw calculation
});

test('getBufferedPercent falls back when native is null', () => {
  // 55000 / 200000 = 27.5% raw, scale = 0.5, buffer = 200000 * 0.165 * 0.5 = 16500 → 36%
  const percent = getBufferedPercent({
    context_window: {
      context_window_size: 200000,
      current_usage: { input_tokens: 55000 },
      used_percentage: null,
    },
  });
  assert.equal(percent, 36); // scaled buffered calculation
});

test('native percentage handles zero correctly', () => {
  assert.equal(getContextPercent({ context_window: { used_percentage: 0 } }), 0);
  assert.equal(getBufferedPercent({ context_window: { used_percentage: 0 } }), 0);
});

test('native percentage clamps negative values to 0', () => {
  assert.equal(getContextPercent({ context_window: { used_percentage: -5 } }), 0);
  assert.equal(getBufferedPercent({ context_window: { used_percentage: -10 } }), 0);
});

test('native percentage clamps values over 100 to 100', () => {
  assert.equal(getContextPercent({ context_window: { used_percentage: 150 } }), 100);
  assert.equal(getBufferedPercent({ context_window: { used_percentage: 200 } }), 100);
});

test('native percentage falls back when NaN', () => {
  const percent = getContextPercent({
    context_window: {
      context_window_size: 200000,
      current_usage: { input_tokens: 55000 },
      used_percentage: NaN,
    },
  });
  assert.equal(percent, 28); // falls back to raw calculation
});

test('getUsageFromStdin returns null when rate_limits are missing', () => {
  assert.equal(getUsageFromStdin({}), null);
  assert.equal(getUsageFromStdin({ rate_limits: null }), null);
});

test('getUsageFromStdin parses official Claude Code rate_limits payload', () => {
  const usage = getUsageFromStdin({
    rate_limits: {
      five_hour: {
        used_percentage: 7.999999999,
        resets_at: 1710000000,
      },
      seven_day: {
        used_percentage: 102.4,
        resets_at: 1710600000,
      },
    },
  });

  assert.deepEqual(usage, {
    fiveHour: 8,
    sevenDay: 100,
    fiveHourResetAt: new Date(1710000000 * 1000),
    sevenDayResetAt: new Date(1710600000 * 1000),
  });
});

test('getUsageFromStdin rejects invalid fields and keeps only official usage data', () => {
  const usage = getUsageFromStdin({
    rate_limits: {
      five_hour: {
        used_percentage: -10,
        resets_at: 0,
      },
      seven_day: {
        used_percentage: Number.NaN,
        resets_at: -1,
      },
    },
  });

  assert.deepEqual(usage, {
    fiveHour: 0,
    sevenDay: null,
    fiveHourResetAt: null,
    sevenDayResetAt: null,
  });
});

test('getModelName precedence: trimmed display name, then normalized bedrock label, then raw id, then fallback', () => {
  assert.equal(getModelName({ model: { display_name: '  Opus  ', id: 'anthropic.claude-3-5-sonnet-20240620-v1:0' } }), 'Opus');
  assert.equal(getModelName({ model: { id: 'anthropic.claude-3-5-sonnet-20240620-v1:0' } }), 'Claude Sonnet 3.5');
  assert.equal(getModelName({ model: { id: 'eu.anthropic.claude-opus-4-5-20251101-v1:0' } }), 'Claude Opus 4.5');
  assert.equal(getModelName({ model: { id: 'us.anthropic.claude-sonnet-4-20250514-v1:0' } }), 'Claude Sonnet 4');
  assert.equal(getModelName({ model: { id: '  apac.anthropic.claude-unknown-nextgen-20250101-v1:0  ' } }), 'apac.anthropic.claude-unknown-nextgen-20250101-v1:0');
  assert.equal(getModelName({ model: { id: '  sonnet-456  ' } }), 'sonnet-456');
  assert.equal(getModelName({ model: { display_name: '   ', id: '   ' } }), 'Unknown');
  assert.equal(getModelName({}), 'Unknown');
});

test('bedrock model detection recognizes bedrock ids', () => {
  assert.ok(isBedrockModelId('anthropic.claude-3-5-sonnet-20240620-v1:0'));
  assert.ok(isBedrockModelId('eu.anthropic.claude-opus-4-5-20251101-v1:0'));
  assert.equal(isBedrockModelId('claude-3-5-sonnet-20241022'), false);
  assert.equal(getProviderLabel({ model: { id: 'anthropic.claude-3-5-sonnet-20240620-v1:0' } }), 'Bedrock');
  assert.equal(getProviderLabel({ model: { id: 'claude-3-5-sonnet-20241022' } }), null);
});

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

test('parseTranscript prefers custom title over slug for session name', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-'));
  const filePath = path.join(dir, 'session-name-custom-title.jsonl');
  const lines = [
    JSON.stringify({ type: 'user', slug: 'auto-slug-1' }),
    JSON.stringify({ type: 'custom-title', customTitle: 'My Renamed Session' }),
    JSON.stringify({ type: 'assistant', slug: 'auto-slug-2' }),
  ];

  await writeFile(filePath, lines.join('\n'), 'utf8');

  try {
    const result = await parseTranscript(filePath);
    assert.equal(result.sessionName, 'My Renamed Session');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('parseTranscript falls back to latest slug when custom title is missing', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-'));
  const filePath = path.join(dir, 'session-name-slug.jsonl');
  const lines = [
    JSON.stringify({ type: 'user', slug: 'auto-slug-1' }),
    JSON.stringify({ type: 'assistant', slug: 'auto-slug-2' }),
  ];

  await writeFile(filePath, lines.join('\n'), 'utf8');

  try {
    const result = await parseTranscript(filePath);
    assert.equal(result.sessionName, 'auto-slug-2');
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
  })}\n`;

  process.env.CLAUDE_CONFIG_DIR = configDir;
  await writeFile(transcriptPath, initialLine, 'utf8');
  fs.utimesSync(transcriptPath, 1710000000, 1710000000);

  try {
    const first = await parseTranscript(transcriptPath);
    assert.equal(first.tools.length, 1);
    assert.equal(first.tools[0].target, '/tmp/original.txt');

    const stat = fs.statSync(transcriptPath);
    const corrupted = '#'.repeat(stat.size);
    await writeFile(transcriptPath, corrupted, 'utf8');
    fs.utimesSync(transcriptPath, 1710000000, 1710000000);

    const second = await parseTranscript(transcriptPath);
    assert.equal(second.tools.length, 1);
    assert.equal(second.tools[0].target, '/tmp/original.txt');
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

test('countConfigs uses CLAUDE_CONFIG_DIR and matching .json sidecar for user scope', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-home-'));
  const customConfigDir = path.join(homeDir, '.claude-2');
  const originalHome = process.env.HOME;
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.HOME = homeDir;
  process.env.CLAUDE_CONFIG_DIR = customConfigDir;

  try {
    // Default directory should be ignored when CLAUDE_CONFIG_DIR is set.
    await mkdir(path.join(homeDir, '.claude', 'rules'), { recursive: true });
    await writeFile(path.join(homeDir, '.claude', 'CLAUDE.md'), 'default-global', 'utf8');
    await writeFile(path.join(homeDir, '.claude', 'rules', 'rule.md'), '# default rule', 'utf8');
    await writeFile(
      path.join(homeDir, '.claude', 'settings.json'),
      JSON.stringify({ mcpServers: { defaultA: {} }, hooks: { onDefault: {} } }),
      'utf8'
    );
    await writeFile(path.join(homeDir, '.claude.json'), JSON.stringify({ disabledMcpServers: ['defaultA'] }), 'utf8');

    // Custom config directory and sidecar should drive user-scope counts.
    await mkdir(customConfigDir, { recursive: true });
    await writeFile(path.join(customConfigDir, 'CLAUDE.md'), 'custom-global', 'utf8');
    await writeFile(
      path.join(customConfigDir, 'settings.json'),
      JSON.stringify({
        mcpServers: { customA: {}, customB: {} },
        hooks: { onStart: {}, onStop: {} },
      }),
      'utf8'
    );
    await writeFile(
      `${customConfigDir}.json`,
      JSON.stringify({ disabledMcpServers: ['customA'] }),
      'utf8'
    );

    const counts = await countConfigs();
    assert.equal(counts.claudeMdCount, 1);
    assert.equal(counts.rulesCount, 0);
    assert.equal(counts.mcpCount, 1);
    assert.equal(counts.hooksCount, 2);
  } finally {
    restoreEnvVar('HOME', originalHome);
    restoreEnvVar('CLAUDE_CONFIG_DIR', originalConfigDir);
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('countConfigs still counts project .claude when cwd is home and CLAUDE_CONFIG_DIR points elsewhere', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-home-'));
  const customConfigDir = path.join(homeDir, '.claude-2');
  const originalHome = process.env.HOME;
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.HOME = homeDir;
  process.env.CLAUDE_CONFIG_DIR = customConfigDir;

  try {
    // User scope: custom config directory
    await mkdir(path.join(customConfigDir, 'rules'), { recursive: true });
    await writeFile(path.join(customConfigDir, 'CLAUDE.md'), 'custom-global', 'utf8');
    await writeFile(path.join(customConfigDir, 'rules', 'user-rule.md'), '# user rule', 'utf8');
    await writeFile(
      path.join(customConfigDir, 'settings.json'),
      JSON.stringify({ mcpServers: { userServer: {} }, hooks: { onUser: {} } }),
      'utf8'
    );

    // Project scope: cwd is home directory with its own .claude contents
    await mkdir(path.join(homeDir, '.claude', 'rules'), { recursive: true });
    await writeFile(path.join(homeDir, '.claude', 'CLAUDE.md'), 'project-alt', 'utf8');
    await writeFile(path.join(homeDir, '.claude', 'rules', 'project-rule.md'), '# project rule', 'utf8');
    await writeFile(
      path.join(homeDir, '.claude', 'settings.json'),
      JSON.stringify({ mcpServers: { projectServer: {} }, hooks: { onProject: {} } }),
      'utf8'
    );

    const counts = await countConfigs(homeDir);
    assert.equal(counts.claudeMdCount, 2);
    assert.equal(counts.rulesCount, 2);
    assert.equal(counts.mcpCount, 2);
    assert.equal(counts.hooksCount, 2);
  } finally {
    restoreEnvVar('HOME', originalHome);
    restoreEnvVar('CLAUDE_CONFIG_DIR', originalConfigDir);
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('countConfigs avoids home cwd double-counting across counters and keeps CLAUDE.local.md', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-home-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;

  try {
    await mkdir(path.join(homeDir, '.claude', 'rules'), { recursive: true });
    await writeFile(path.join(homeDir, '.claude', 'CLAUDE.md'), 'global', 'utf8');
    await writeFile(path.join(homeDir, '.claude', 'CLAUDE.local.md'), 'global-local', 'utf8');
    await writeFile(path.join(homeDir, '.claude', 'rules', 'rule.md'), '# rule', 'utf8');
    await writeFile(
      path.join(homeDir, '.claude', 'settings.json'),
      JSON.stringify({ mcpServers: { one: {} }, hooks: { onStart: {} } }),
      'utf8'
    );

    const exactCounts = await countConfigs(homeDir);
    assert.equal(exactCounts.claudeMdCount, 2);
    assert.equal(exactCounts.rulesCount, 1);
    assert.equal(exactCounts.mcpCount, 1);
    assert.equal(exactCounts.hooksCount, 1);

    const trailingSlashCounts = await countConfigs(`${homeDir}${path.sep}`);
    assert.equal(trailingSlashCounts.claudeMdCount, 2);
    assert.equal(trailingSlashCounts.rulesCount, 1);
    assert.equal(trailingSlashCounts.mcpCount, 1);
    assert.equal(trailingSlashCounts.hooksCount, 1);
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('countConfigs excludes disabled user-scope MCPs', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-home-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;

  try {
    await mkdir(path.join(homeDir, '.claude'), { recursive: true });
    // 3 MCPs defined in settings.json
    await writeFile(
      path.join(homeDir, '.claude', 'settings.json'),
      JSON.stringify({ mcpServers: { server1: {}, server2: {}, server3: {} } }),
      'utf8'
    );
    // 1 MCP disabled in ~/.claude.json
    await writeFile(
      path.join(homeDir, '.claude.json'),
      JSON.stringify({ disabledMcpServers: ['server2'] }),
      'utf8'
    );

    const counts = await countConfigs();
    assert.equal(counts.mcpCount, 2); // 3 - 1 disabled = 2
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('countConfigs excludes disabled project .mcp.json servers', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-home-'));
  const projectDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-project-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;

  try {
    await mkdir(path.join(homeDir, '.claude'), { recursive: true });
    await mkdir(path.join(projectDir, '.claude'), { recursive: true });

    // 4 MCPs in .mcp.json
    await writeFile(
      path.join(projectDir, '.mcp.json'),
      JSON.stringify({ mcpServers: { mcp1: {}, mcp2: {}, mcp3: {}, mcp4: {} } }),
      'utf8'
    );
    // 2 disabled via disabledMcpjsonServers
    await writeFile(
      path.join(projectDir, '.claude', 'settings.local.json'),
      JSON.stringify({ disabledMcpjsonServers: ['mcp2', 'mcp4'] }),
      'utf8'
    );

    const counts = await countConfigs(projectDir);
    assert.equal(counts.mcpCount, 2); // 4 - 2 disabled = 2
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  }
});

test('countConfigs handles all MCPs disabled', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-home-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;

  try {
    await mkdir(path.join(homeDir, '.claude'), { recursive: true });
    // 2 MCPs defined
    await writeFile(
      path.join(homeDir, '.claude', 'settings.json'),
      JSON.stringify({ mcpServers: { serverA: {}, serverB: {} } }),
      'utf8'
    );
    // Both disabled
    await writeFile(
      path.join(homeDir, '.claude.json'),
      JSON.stringify({ disabledMcpServers: ['serverA', 'serverB'] }),
      'utf8'
    );

    const counts = await countConfigs();
    assert.equal(counts.mcpCount, 0); // All disabled
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
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

test('countConfigs ignores non-string values in disabledMcpServers', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-home-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;

  try {
    await mkdir(path.join(homeDir, '.claude'), { recursive: true });
    // 3 MCPs defined
    await writeFile(
      path.join(homeDir, '.claude', 'settings.json'),
      JSON.stringify({ mcpServers: { server1: {}, server2: {}, server3: {} } }),
      'utf8'
    );
    // disabledMcpServers contains mixed types - only 'server2' is a valid string
    await writeFile(
      path.join(homeDir, '.claude.json'),
      JSON.stringify({ disabledMcpServers: [123, null, 'server2', { name: 'server3' }, [], true] }),
      'utf8'
    );

    const counts = await countConfigs();
    assert.equal(counts.mcpCount, 2); // Only 'server2' disabled, server1 and server3 remain
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('countConfigs counts same-named servers in different scopes separately', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-home-'));
  const projectDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-project-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;

  try {
    await mkdir(path.join(homeDir, '.claude'), { recursive: true });
    await mkdir(path.join(projectDir, '.claude'), { recursive: true });

    // User scope: server named 'shared-server'
    await writeFile(
      path.join(homeDir, '.claude', 'settings.json'),
      JSON.stringify({ mcpServers: { 'shared-server': {}, 'user-only': {} } }),
      'utf8'
    );

    // Project scope: also has 'shared-server' (different config, same name)
    await writeFile(
      path.join(projectDir, '.mcp.json'),
      JSON.stringify({ mcpServers: { 'shared-server': {}, 'project-only': {} } }),
      'utf8'
    );

    const counts = await countConfigs(projectDir);
    // 'shared-server' counted in BOTH scopes (user + project) = 4 total
    assert.equal(counts.mcpCount, 4);
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  }
});

test('countConfigs uses case-sensitive matching for disabled servers', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-home-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;

  try {
    await mkdir(path.join(homeDir, '.claude'), { recursive: true });
    // MCP named 'MyServer' (mixed case)
    await writeFile(
      path.join(homeDir, '.claude', 'settings.json'),
      JSON.stringify({ mcpServers: { MyServer: {}, otherServer: {} } }),
      'utf8'
    );
    // Try to disable with wrong case - should NOT work
    await writeFile(
      path.join(homeDir, '.claude.json'),
      JSON.stringify({ disabledMcpServers: ['myserver', 'MYSERVER', 'OTHERSERVER'] }),
      'utf8'
    );

    const counts = await countConfigs();
    // Both servers should still be enabled (case mismatch means not disabled)
    assert.equal(counts.mcpCount, 2);
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
  }
});

// Regression test for GitHub Issue #3:
// "MCP count showing 5 when user has 6, still showing 5 when all disabled"
// https://github.com/jarrodwatts/claude-hud/issues/3
test('Issue #3: MCP count updates correctly when servers are disabled', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-home-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;

  try {
    await mkdir(path.join(homeDir, '.claude'), { recursive: true });

    // User has 6 MCPs configured (simulating the issue reporter's setup)
    await writeFile(
      path.join(homeDir, '.claude.json'),
      JSON.stringify({
        mcpServers: {
          mcp1: { command: 'cmd1' },
          mcp2: { command: 'cmd2' },
          mcp3: { command: 'cmd3' },
          mcp4: { command: 'cmd4' },
          mcp5: { command: 'cmd5' },
          mcp6: { command: 'cmd6' },
        },
      }),
      'utf8'
    );

    // Scenario 1: No servers disabled - should show 6
    let counts = await countConfigs();
    assert.equal(counts.mcpCount, 6, 'Should show all 6 MCPs when none disabled');

    // Scenario 2: 1 server disabled - should show 5 (this was the initial bug report state)
    await writeFile(
      path.join(homeDir, '.claude.json'),
      JSON.stringify({
        mcpServers: {
          mcp1: { command: 'cmd1' },
          mcp2: { command: 'cmd2' },
          mcp3: { command: 'cmd3' },
          mcp4: { command: 'cmd4' },
          mcp5: { command: 'cmd5' },
          mcp6: { command: 'cmd6' },
        },
        disabledMcpServers: ['mcp1'],
      }),
      'utf8'
    );
    counts = await countConfigs();
    assert.equal(counts.mcpCount, 5, 'Should show 5 MCPs when 1 is disabled');

    // Scenario 3: ALL servers disabled - should show 0 (this was the main bug)
    await writeFile(
      path.join(homeDir, '.claude.json'),
      JSON.stringify({
        mcpServers: {
          mcp1: { command: 'cmd1' },
          mcp2: { command: 'cmd2' },
          mcp3: { command: 'cmd3' },
          mcp4: { command: 'cmd4' },
          mcp5: { command: 'cmd5' },
          mcp6: { command: 'cmd6' },
        },
        disabledMcpServers: ['mcp1', 'mcp2', 'mcp3', 'mcp4', 'mcp5', 'mcp6'],
      }),
      'utf8'
    );
    counts = await countConfigs();
    assert.equal(counts.mcpCount, 0, 'Should show 0 MCPs when all are disabled');
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
  }
});
