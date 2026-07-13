import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _setCreateReadStreamForTests, parseTranscript } from '../dist/transcript.js';
import { countConfigs } from '../dist/config-reader.js';
import { getContextPercent, getBufferedPercent, getModelName, getProviderLabel, getUsageFromStdin, isBedrockModelId, stripContextSuffix, formatModelName, resolveModelName } from '../dist/stdin.js';
import { estimateSessionCost, resolveSessionCost, formatUsd } from '../dist/cost.js';
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
  // used_percentage: 0 with no tokens → still 0
  assert.equal(getContextPercent({ context_window: { used_percentage: 0 } }), 0);
  assert.equal(getBufferedPercent({ context_window: { used_percentage: 0 } }), 0);
});

test('getContextPercent falls through to token-based calculation when used_percentage is 0 but tokens exist', () => {
  // On a fresh session Claude Code emits used_percentage=0 before the first API
  // response, while current_usage already contains the initial-context tokens
  // (system prompt, tools, memory files).  The HUD should reflect them.
  // 18200 / 200000 = 9.1% → rounds to 9%
  const percent = getContextPercent({
    context_window: {
      context_window_size: 200000,
      current_usage: { input_tokens: 18200 },
      used_percentage: 0,
    },
  });
  assert.equal(percent, 9);
});

test('getBufferedPercent falls through to token-based calculation when used_percentage is 0 but tokens exist', () => {
  // Same fresh-session scenario for the buffered variant.
  // 18200 / 200000 = 9.1% raw; scale = (0.091 - 0.05) / (0.50 - 0.05) ≈ 0.091
  // buffer = 200000 * 0.165 * 0.091 ≈ 3003; (18200 + 3003) / 200000 ≈ 10.6% → 11%
  const percent = getBufferedPercent({
    context_window: {
      context_window_size: 200000,
      current_usage: { input_tokens: 18200 },
      used_percentage: 0,
    },
  });
  assert.ok(percent > 9, `expected buffered percent > 9, got ${percent}`);
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

test('stripContextSuffix removes parenthetical context-window info', () => {
  assert.equal(stripContextSuffix('Opus 4.6 (1M context)'), 'Opus 4.6');
  assert.equal(stripContextSuffix('Sonnet 4 (200k context)'), 'Sonnet 4');
  assert.equal(stripContextSuffix('Claude 3.5 Haiku (200k context)'), 'Claude 3.5 Haiku');
  assert.equal(stripContextSuffix('Model (with 1M context)'), 'Model');
  assert.equal(stripContextSuffix('Model (extended context window)'), 'Model');
  // Case-insensitive
  assert.equal(stripContextSuffix('Opus (1M CONTEXT)'), 'Opus');
  // Preserves non-context parentheticals
  assert.equal(stripContextSuffix('Model (beta)'), 'Model (beta)');
  assert.equal(stripContextSuffix('Model (preview)'), 'Model (preview)');
  // No-op when no suffix present
  assert.equal(stripContextSuffix('Sonnet 4.6'), 'Sonnet 4.6');
  assert.equal(stripContextSuffix(''), '');
});

test('formatModelName full mode returns name unchanged', () => {
  assert.equal(formatModelName('Opus 4.6 (1M context)', 'full'), 'Opus 4.6 (1M context)');
  assert.equal(formatModelName('Claude Sonnet 3.5', 'full'), 'Claude Sonnet 3.5');
  // undefined format defaults to full (backward-compatible)
  assert.equal(formatModelName('Opus 4.6 (1M context)'), 'Opus 4.6 (1M context)');
});

test('formatModelName compact mode strips context suffix only', () => {
  assert.equal(formatModelName('Opus 4.6 (1M context)', 'compact'), 'Opus 4.6');
  assert.equal(formatModelName('Claude Sonnet 3.5 (200k context)', 'compact'), 'Claude Sonnet 3.5');
  assert.equal(formatModelName('Claude Haiku (with 1M context)', 'compact'), 'Claude Haiku');
  // Preserves "Claude " prefix in compact mode
  assert.equal(formatModelName('Claude Opus 4.5', 'compact'), 'Claude Opus 4.5');
  // Preserves non-context parentheticals
  assert.equal(formatModelName('Model (beta)', 'compact'), 'Model (beta)');
});

test('formatModelName short mode strips context suffix and Claude prefix', () => {
  assert.equal(formatModelName('Claude Opus 4.5 (1M context)', 'short'), 'Opus 4.5');
  assert.equal(formatModelName('Claude Sonnet 3.5 (200k context)', 'short'), 'Sonnet 3.5');
  assert.equal(formatModelName('Claude Haiku', 'short'), 'Haiku');
  // Already short names are unchanged
  assert.equal(formatModelName('Opus 4.6', 'short'), 'Opus 4.6');
  assert.equal(formatModelName('Sonnet', 'short'), 'Sonnet');
  // Case-insensitive Claude prefix removal
  assert.equal(formatModelName('claude Opus 4.5', 'short'), 'Opus 4.5');
});

test('formatModelName override replaces model name entirely', () => {
  // Override takes precedence over format
  assert.equal(formatModelName('Claude Opus 4.5', 'full', "zane's intelligent opus"), "zane's intelligent opus");
  assert.equal(formatModelName('Claude Opus 4.5', 'compact', 'My Model'), 'My Model');
  assert.equal(formatModelName('Claude Opus 4.5', 'short', 'Custom'), 'Custom');
  assert.equal(formatModelName('Claude Opus 4.5', undefined, 'Override'), 'Override');
  // Empty override is treated as unset (falls through to format)
  assert.equal(formatModelName('Claude Opus 4.5 (1M context)', 'compact', ''), 'Claude Opus 4.5');
  assert.equal(formatModelName('Opus 4.6', 'full', ''), 'Opus 4.6');
});

test('resolveModelName preserves stdin as the default source', () => {
  const stdin = { model: { display_name: 'Claude Opus' } };
  const transcript = { lastAssistantModel: 'glm-5.2' };

  assert.equal(resolveModelName(stdin, transcript), 'Claude Opus');
  assert.equal(resolveModelName(stdin, transcript, 'stdin'), 'Claude Opus');
});

test('resolveModelName supports opt-in auto and transcript sources', () => {
  const stdin = { model: { display_name: 'Claude Opus' } };

  assert.equal(resolveModelName(stdin, { lastAssistantModel: 'glm-5.2' }, 'auto'), 'glm-5.2');
  assert.equal(resolveModelName(stdin, { lastAssistantModel: 'claude-sonnet-4-6' }, 'auto'), 'Claude Opus');
  assert.equal(resolveModelName(stdin, { lastAssistantModel: 'claude-sonnet-4-6' }, 'transcript'), 'claude-sonnet-4-6');
});

test('resolveModelName falls back to stdin when the transcript model is missing', () => {
  const stdin = { model: { display_name: 'Claude Opus' } };

  assert.equal(resolveModelName(stdin, undefined, 'auto'), 'Claude Opus');
  assert.equal(resolveModelName(stdin, {}, 'transcript'), 'Claude Opus');
});

test('resolveModelName sanitizes and caps transcript models at the render boundary', () => {
  const malicious = `proxy-\x1b[31mred\x1b[0m\x1b]8;;https://evil.test\x07link\x1b]8;;\x07\u202E${'x'.repeat(100)}`;
  const resolved = resolveModelName(
    { model: { display_name: 'Claude Opus' } },
    { lastAssistantModel: malicious },
    'transcript',
  );

  assert.ok(resolved.startsWith('proxy-redlink'));
  assert.equal(resolved.length, 80);
  assert.doesNotMatch(resolved, /[\x1b\u202E]/u);
});

test('bedrock model detection recognizes bedrock ids', () => {
  assert.ok(isBedrockModelId('anthropic.claude-3-5-sonnet-20240620-v1:0'));
  assert.ok(isBedrockModelId('eu.anthropic.claude-opus-4-5-20251101-v1:0'));
  assert.equal(isBedrockModelId('claude-3-5-sonnet-20241022'), false);
  process.env.CLAUDE_CODE_USE_BEDROCK = '1';
  try {
    assert.equal(getProviderLabel({ model: { id: 'anthropic.claude-3-5-sonnet-20240620-v1:0' } }), 'Bedrock');
  } finally {
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
  }
  assert.equal(getProviderLabel({ model: { id: 'claude-3-5-sonnet-20241022' } }), null);
});

test('resolveSessionCost prefers native stdin cost when available', () => {
  const cost = resolveSessionCost(
    {
      model: { display_name: 'Claude Sonnet 4.5' },
      cost: { total_cost_usd: 1.23 },
    },
    {
      inputTokens: 100000,
      cacheCreationTokens: 10000,
      cacheReadTokens: 20000,
      outputTokens: 50000,
    },
  );

  assert.deepEqual(cost, {
    totalUsd: 1.23,
    source: 'native',
  });
});

test('resolveSessionCost falls back to transcript estimation when native cost is absent', () => {
  const cost = resolveSessionCost(
    { model: { display_name: 'Claude Opus 4.5' } },
    {
      inputTokens: 100000,
      cacheCreationTokens: 10000,
      cacheReadTokens: 20000,
      outputTokens: 50000,
    },
  );

  assert.ok(cost, 'expected fallback estimate');
  assert.equal(cost?.source, 'estimate');
  assert.equal(formatUsd(cost?.totalUsd ?? 0), '$1.82');
});

test('resolveSessionCost ignores native cost for provider-routed sessions', () => {
  process.env.CLAUDE_CODE_USE_BEDROCK = '1';
  try {
    const cost = resolveSessionCost(
      {
        model: { id: 'anthropic.claude-sonnet-4-20250514-v1:0' },
        cost: { total_cost_usd: 0 },
      },
      {
        inputTokens: 100000,
        cacheCreationTokens: 10000,
        cacheReadTokens: 20000,
        outputTokens: 50000,
      },
    );

    assert.equal(cost, null);
  } finally {
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
  }
});

test('resolveSessionCost falls back when native cost is invalid', () => {
  const cost = resolveSessionCost(
    {
      model: { display_name: 'Claude Sonnet 4.5' },
      cost: { total_cost_usd: Number.NaN },
    },
    {
      inputTokens: 100000,
      cacheCreationTokens: 10000,
      cacheReadTokens: 20000,
      outputTokens: 50000,
    },
  );

  assert.ok(cost, 'expected fallback estimate');
  assert.equal(cost?.source, 'estimate');
  assert.equal(formatUsd(cost?.totalUsd ?? 0), '$1.09');
});

test('estimateSessionCost still calculates transcript-based Anthropic pricing', () => {
  const estimate = estimateSessionCost(
    { model: { display_name: 'Claude Sonnet 4.5' } },
    {
      inputTokens: 100000,
      cacheCreationTokens: 10000,
      cacheReadTokens: 20000,
      outputTokens: 50000,
    },
  );

  assert.ok(estimate, 'expected transcript estimate');
  assert.equal(formatUsd(estimate.totalUsd), '$1.09');
});

test('estimateSessionCost prices Claude Haiku 4.5 (and future 4.x minors)', () => {
  const tokens = {
    inputTokens: 1_000_000,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 100_000,
  };

  const haiku45 = estimateSessionCost({ model: { display_name: 'Claude Haiku 4.5' } }, tokens);
  assert.ok(haiku45, 'expected non-null estimate for Claude Haiku 4.5');
  // 1M input @ $1 + 100k output @ $5 = $1 + $0.5 = $1.50
  assert.equal(formatUsd(haiku45.totalUsd), '$1.50');

  // Bare "Haiku 4" (short name) should also match.
  const haiku4Bare = estimateSessionCost({ model: { display_name: 'Claude Haiku 4' } }, tokens);
  assert.ok(haiku4Bare, 'expected non-null estimate for bare Claude Haiku 4');
  assert.equal(formatUsd(haiku4Bare.totalUsd), '$1.50');

  // Haiku 3.5 pricing stays on its own row.
  const haiku35 = estimateSessionCost({ model: { display_name: 'Claude Haiku 3.5' } }, tokens);
  assert.ok(haiku35, 'expected non-null estimate for Claude Haiku 3.5');
  // 1M input @ $0.8 + 100k output @ $4 = $0.8 + $0.4 = $1.20
  assert.equal(formatUsd(haiku35.totalUsd), '$1.20');
});

test('estimateSessionCost prices newer Opus 4 models below the Opus 4.0 and 4.1 fallback', () => {
  const tokens = {
    inputTokens: 1_000_000,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 100_000,
  };

  const opus45 = estimateSessionCost({ model: { display_name: 'Claude Opus 4.5' } }, tokens);
  assert.ok(opus45, 'expected non-null estimate for Claude Opus 4.5');
  assert.equal(formatUsd(opus45.totalUsd), '$7.50');

  const opus46 = estimateSessionCost({ model: { display_name: 'Claude Opus 4.6' } }, tokens);
  assert.ok(opus46, 'expected non-null estimate for Claude Opus 4.6');
  assert.equal(formatUsd(opus46.totalUsd), '$7.50');

  // Tests that Bedrock-style strings in display_name are normalized correctly.
  // Real Bedrock sessions set model.id (triggering isBedrockModelId → null),
  // so this exercises the regex normalization path, not real Bedrock pricing.
  const bedrockOpus46 = estimateSessionCost({ model: { display_name: 'eu.anthropic.claude-opus-4-6-v1:0' } }, tokens);
  assert.ok(bedrockOpus46, 'expected model ID normalization to match Claude Opus 4.6');
  assert.equal(formatUsd(bedrockOpus46.totalUsd), '$7.50');

  const opus41 = estimateSessionCost({ model: { display_name: 'Claude Opus 4.1' } }, tokens);
  assert.ok(opus41, 'expected non-null estimate for Claude Opus 4.1');
  assert.equal(formatUsd(opus41.totalUsd), '$22.50');
});

test('estimateSessionCost returns null for real Bedrock sessions with model.id set', () => {
  const tokens = {
    inputTokens: 1_000_000,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 100_000,
  };

  const result = estimateSessionCost(
    { model: { id: 'eu.anthropic.claude-opus-4-5-v1:0', display_name: 'Claude Opus 4.5' } },
    tokens,
  );
  assert.equal(result, null, 'Bedrock sessions (model.id contains anthropic.claude-) should skip estimation');
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

test('countConfigs returns outputStyle with project local precedence', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-home-'));
  const projectDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-project-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;

  try {
    await mkdir(path.join(homeDir, '.claude'), { recursive: true });
    await mkdir(path.join(projectDir, '.claude'), { recursive: true });

    await writeFile(
      path.join(homeDir, '.claude', 'settings.local.json'),
      JSON.stringify({ outputStyle: 'default-user-style' }),
      'utf8',
    );
    await writeFile(
      path.join(projectDir, '.claude', 'settings.json'),
      JSON.stringify({ outputStyle: 'project-base-style' }),
      'utf8',
    );
    await writeFile(
      path.join(projectDir, '.claude', 'settings.local.json'),
      JSON.stringify({ outputStyle: 'tech-leader' }),
      'utf8',
    );

    const counts = await countConfigs(projectDir);
    assert.equal(counts.outputStyle, 'tech-leader');
  } finally {
    restoreEnvVar('HOME', originalHome);
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

test('countConfigs follows symlinked rule files and directories safely', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-home-'));
  const projectDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-project-'));
  const sharedDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-rules-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;

  try {
    const rulesDir = path.join(projectDir, '.claude', 'rules');
    await mkdir(rulesDir, { recursive: true });
    await writeFile(path.join(sharedDir, 'shared.md'), '# shared', 'utf8');
    await writeFile(path.join(sharedDir, 'direct.md'), '# direct', 'utf8');
    fs.symlinkSync(sharedDir, path.join(rulesDir, 'pack'), 'dir');
    fs.symlinkSync(path.join(sharedDir, 'direct.md'), path.join(rulesDir, 'linked.md'), 'file');

    const counts = await countConfigs(projectDir);
    assert.equal(counts.rulesCount, 2);

    const statBefore = fs.statSync(sharedDir);
    await writeFile(path.join(sharedDir, 'added.md'), '# added', 'utf8');
    fs.utimesSync(sharedDir, statBefore.atimeMs / 1000 + 1, statBefore.mtimeMs / 1000 + 1);
    const updated = await countConfigs(projectDir);
    assert.equal(updated.rulesCount, 3, 'cache should invalidate when a symlink target changes');
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
    await rm(sharedDir, { recursive: true, force: true });
  }
});

test('countConfigs skips dangling links, cycles, and duplicate symlink targets', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-home-'));
  const projectDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-project-'));
  const sharedDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-rules-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;

  try {
    const rulesDir = path.join(projectDir, '.claude', 'rules');
    await mkdir(rulesDir, { recursive: true });
    await writeFile(path.join(sharedDir, 'one.md'), '# one', 'utf8');
    fs.symlinkSync(sharedDir, path.join(rulesDir, 'pack-a'), 'dir');
    fs.symlinkSync(sharedDir, path.join(rulesDir, 'pack-b'), 'dir');
    fs.symlinkSync(rulesDir, path.join(sharedDir, 'cycle'), 'dir');
    fs.symlinkSync(path.join(sharedDir, 'missing.md'), path.join(rulesDir, 'dangling.md'), 'file');

    const counts = await countConfigs(projectDir);
    assert.equal(counts.rulesCount, 1);
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
    await rm(sharedDir, { recursive: true, force: true });
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

// === Config cache tests ===

async function getConfigCacheDir(configDir) {
  return path.join(configDir, 'plugins', 'claude-hud', 'config-cache');
}

test('countConfigs cache: second call uses cache (mtime unchanged)', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-cc-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;

  try {
    await mkdir(path.join(homeDir, '.claude'), { recursive: true });
    await writeFile(path.join(homeDir, '.claude', 'CLAUDE.md'), 'global', 'utf8');

    const settingsContent = JSON.stringify({ mcpServers: { one: {} } });
    const settingsPath = path.join(homeDir, '.claude', 'settings.json');
    await writeFile(settingsPath, settingsContent, 'utf8');

    // Pin mtimes to fixed integer seconds to avoid float precision loss
    const claudeDir = path.join(homeDir, '.claude');
    const claudeMdPath = path.join(claudeDir, 'CLAUDE.md');
    fs.utimesSync(settingsPath, 1710000000, 1710000000);
    fs.utimesSync(claudeMdPath, 1710000000, 1710000000);

    const first = await countConfigs();
    assert.equal(first.claudeMdCount, 1);
    assert.equal(first.mcpCount, 1);

    // Verify cache file was created
    const cacheDir = await getConfigCacheDir(claudeDir);
    assert.ok(fs.existsSync(cacheDir), 'config-cache directory should exist');

    // Corrupt the settings file but preserve mtime+size
    await writeFile(settingsPath, 'x'.repeat(settingsContent.length), 'utf8');
    fs.utimesSync(settingsPath, 1710000000, 1710000000);

    // Second call should still return cached result
    const second = await countConfigs();
    assert.equal(second.claudeMdCount, 1);
    assert.equal(second.mcpCount, 1);
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('countConfigs cache: miss on file modification (mtime changes)', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-cc-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;

  try {
    await mkdir(path.join(homeDir, '.claude'), { recursive: true });
    await writeFile(
      path.join(homeDir, '.claude', 'settings.json'),
      JSON.stringify({ mcpServers: { one: {} } }),
      'utf8'
    );

    const first = await countConfigs();
    assert.equal(first.mcpCount, 1);

    // Modify settings.json — use explicit mtime bump to avoid timing flakiness
    const settingsPath = path.join(homeDir, '.claude', 'settings.json');
    const statBefore = fs.statSync(settingsPath);
    await writeFile(
      settingsPath,
      JSON.stringify({ mcpServers: { one: {}, two: {}, three: {} } }),
      'utf8'
    );
    // Force mtime forward by 1 second
    fs.utimesSync(settingsPath, statBefore.atimeMs / 1000 + 1, statBefore.mtimeMs / 1000 + 1);

    const second = await countConfigs();
    assert.equal(second.mcpCount, 3, 'Should detect updated settings.json');
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('countConfigs cache: miss on file creation (CLAUDE.md appears)', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-cc-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;

  try {
    await mkdir(path.join(homeDir, '.claude'), { recursive: true });

    const first = await countConfigs();
    assert.equal(first.claudeMdCount, 0);

    // Create CLAUDE.md — changes the directory mtime
    await writeFile(path.join(homeDir, '.claude', 'CLAUDE.md'), 'global', 'utf8');

    const second = await countConfigs();
    assert.equal(second.claudeMdCount, 1, 'Should detect newly created CLAUDE.md');
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('countConfigs cache: miss on file deletion (CLAUDE.md removed)', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-cc-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;

  try {
    await mkdir(path.join(homeDir, '.claude'), { recursive: true });
    await writeFile(path.join(homeDir, '.claude', 'CLAUDE.md'), 'global', 'utf8');

    const first = await countConfigs();
    assert.equal(first.claudeMdCount, 1);

    // Delete CLAUDE.md — changes the directory mtime
    fs.unlinkSync(path.join(homeDir, '.claude', 'CLAUDE.md'));

    const second = await countConfigs();
    assert.equal(second.claudeMdCount, 0, 'Should detect deleted CLAUDE.md');
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('countConfigs cache: miss on nested rules additions', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-cc-'));
  const projectDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-proj-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;

  try {
    await mkdir(path.join(homeDir, '.claude'), { recursive: true });
    await mkdir(path.join(projectDir, '.claude', 'rules', 'nested'), { recursive: true });
    await writeFile(path.join(projectDir, '.claude', 'rules', 'nested', 'one.md'), '# one', 'utf8');

    const first = await countConfigs(projectDir);
    assert.equal(first.rulesCount, 1);

    await writeFile(path.join(projectDir, '.claude', 'rules', 'nested', 'two.md'), '# two', 'utf8');

    const second = await countConfigs(projectDir);
    assert.equal(second.rulesCount, 2, 'Should detect nested rules added after the cache was written');
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  }
});

test('countConfigs cache: isolation between different cwds', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-cc-'));
  const projectA = await mkdtemp(path.join(tmpdir(), 'claude-hud-projA-'));
  const projectB = await mkdtemp(path.join(tmpdir(), 'claude-hud-projB-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;

  try {
    await mkdir(path.join(homeDir, '.claude'), { recursive: true });
    await writeFile(path.join(projectA, 'CLAUDE.md'), 'projA', 'utf8');
    // projectB has no CLAUDE.md

    const countsA = await countConfigs(projectA);
    const countsB = await countConfigs(projectB);

    assert.equal(countsA.claudeMdCount, 1, 'Project A should have 1 CLAUDE.md');
    assert.equal(countsB.claudeMdCount, 0, 'Project B should have 0 CLAUDE.md');

    // Verify both get independent caches
    const cacheDir = await getConfigCacheDir(path.join(homeDir, '.claude'));
    const cacheFiles = fs.readdirSync(cacheDir);
    assert.ok(cacheFiles.length >= 2, 'Should have separate cache files for different cwds');
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
    await rm(projectA, { recursive: true, force: true });
    await rm(projectB, { recursive: true, force: true });
  }
});

test('countConfigs cache: isolation between different CLAUDE_CONFIG_DIRs', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-cc-'));
  const configA = path.join(homeDir, '.claude-a');
  const configB = path.join(homeDir, '.claude-b');
  const originalHome = process.env.HOME;
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.HOME = homeDir;

  try {
    await mkdir(configA, { recursive: true });
    await mkdir(configB, { recursive: true });
    await writeFile(path.join(configA, 'CLAUDE.md'), 'config-a', 'utf8');
    // configB has no CLAUDE.md

    process.env.CLAUDE_CONFIG_DIR = configA;
    const countsA = await countConfigs();

    process.env.CLAUDE_CONFIG_DIR = configB;
    const countsB = await countConfigs();

    assert.equal(countsA.claudeMdCount, 1, 'Config A should have 1 CLAUDE.md');
    assert.equal(countsB.claudeMdCount, 0, 'Config B should have 0 CLAUDE.md');
  } finally {
    restoreEnvVar('HOME', originalHome);
    restoreEnvVar('CLAUDE_CONFIG_DIR', originalConfigDir);
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('countConfigs cache: corrupted cache file handled gracefully', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-cc-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;

  try {
    await mkdir(path.join(homeDir, '.claude'), { recursive: true });
    await writeFile(path.join(homeDir, '.claude', 'CLAUDE.md'), 'global', 'utf8');

    // First call populates cache
    const first = await countConfigs();
    assert.equal(first.claudeMdCount, 1);

    // Corrupt all cache files
    const cacheDir = await getConfigCacheDir(path.join(homeDir, '.claude'));
    const cacheFiles = fs.readdirSync(cacheDir);
    for (const file of cacheFiles) {
      fs.writeFileSync(path.join(cacheDir, file), '{not-valid-json!!!', 'utf8');
    }

    // Should still return correct results via fresh recompute
    const second = await countConfigs();
    assert.equal(second.claudeMdCount, 1, 'Should recompute correctly after cache corruption');
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('countConfigs cache: malformed cache payload falls back to fresh recompute', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-cc-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;

  try {
    await mkdir(path.join(homeDir, '.claude'), { recursive: true });
    await writeFile(path.join(homeDir, '.claude', 'CLAUDE.md'), 'global', 'utf8');

    const first = await countConfigs();
    assert.equal(first.claudeMdCount, 1);

    const cacheDir = await getConfigCacheDir(path.join(homeDir, '.claude'));
    const cacheFiles = fs.readdirSync(cacheDir);
    assert.equal(cacheFiles.length, 1);

    fs.writeFileSync(path.join(cacheDir, cacheFiles[0]), JSON.stringify({
      key: {
        cwd: null,
        claudeConfigDir: path.join(homeDir, '.claude'),
        sentinels: {
          [path.join(homeDir, '.claude', 'CLAUDE.md')]: fs.existsSync(path.join(homeDir, '.claude', 'CLAUDE.md'))
            ? { mtimeMs: fs.statSync(path.join(homeDir, '.claude', 'CLAUDE.md')).mtimeMs, size: fs.statSync(path.join(homeDir, '.claude', 'CLAUDE.md')).size }
            : null,
          [path.join(homeDir, '.claude', 'rules')]: null,
          [path.join(homeDir, '.claude', 'settings.json')]: null,
          [path.join(homeDir, '.claude.json')]: null,
        },
      },
      data: {
        claudeMdCount: 'oops',
        rulesCount: 999,
        mcpCount: 999,
        hooksCount: 999,
      },
    }), 'utf8');

    const second = await countConfigs();
    assert.equal(second.claudeMdCount, 1, 'Should ignore malformed cached counts and recompute');
    assert.equal(second.rulesCount, 0);
    assert.equal(second.mcpCount, 0);
    assert.equal(second.hooksCount, 0);
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('countConfigs cache: first invocation without cache dir', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-cc-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;

  try {
    await mkdir(path.join(homeDir, '.claude'), { recursive: true });
    await writeFile(path.join(homeDir, '.claude', 'CLAUDE.md'), 'global', 'utf8');
    await writeFile(
      path.join(homeDir, '.claude', 'settings.json'),
      JSON.stringify({ mcpServers: { s1: {} }, hooks: { onStart: {} } }),
      'utf8'
    );

    // No config-cache/ dir exists yet
    const cacheDir = await getConfigCacheDir(path.join(homeDir, '.claude'));
    assert.ok(!fs.existsSync(cacheDir), 'config-cache should not exist initially');

    const result = await countConfigs();
    assert.equal(result.claudeMdCount, 1);
    assert.equal(result.mcpCount, 1);
    assert.equal(result.hooksCount, 1);

    // Cache dir should now be created
    assert.ok(fs.existsSync(cacheDir), 'config-cache should be created after first call');
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('countConfigs cache: works without cwd (user scope only)', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-cc-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;

  try {
    await mkdir(path.join(homeDir, '.claude'), { recursive: true });
    await writeFile(path.join(homeDir, '.claude', 'CLAUDE.md'), 'global', 'utf8');
    await writeFile(
      path.join(homeDir, '.claude', 'settings.json'),
      JSON.stringify({ mcpServers: { a: {}, b: {} } }),
      'utf8'
    );

    // First call without cwd
    const first = await countConfigs();
    assert.equal(first.claudeMdCount, 1);
    assert.equal(first.mcpCount, 2);

    // Verify cache was written
    const cacheDir = await getConfigCacheDir(path.join(homeDir, '.claude'));
    assert.ok(fs.existsSync(cacheDir), 'cache should exist after first call');

    // Second call should use cache
    const second = await countConfigs();
    assert.equal(second.claudeMdCount, 1);
    assert.equal(second.mcpCount, 2);
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
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
