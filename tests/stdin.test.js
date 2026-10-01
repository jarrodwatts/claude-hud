import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import {
  formatModelName,
  getContextUsage,
  getModelName,
  getProviderLabel,
  getUsageFromStdin,
  isContextUnreported,
  readStdin,
  resolveModelName,
  stdinText,
} from '../dist/stdin.js';
import { formatUsd, getNativeCostUsd } from '../dist/cost.js';

const usage = (input, cacheWrite = 0, cacheRead = 0) => ({
  input_tokens: input,
  cache_creation_input_tokens: cacheWrite,
  cache_read_input_tokens: cacheRead,
});

test('readStdin parses JSON as soon as it is complete and rejects bad input', async () => {
  const stream = new PassThrough();
  const pending = readStdin(stream);
  stream.write('{"model":');
  stream.write('{"display_name":"Opus"}}');
  assert.deepEqual(await pending, { model: { display_name: 'Opus' } });

  for (const input of ['not json', '42', '']) {
    const bad = new PassThrough();
    const result = readStdin(bad);
    bad.end(input);
    assert.equal(await result, null, `input ${JSON.stringify(input)}`);
  }
  assert.equal(await readStdin({ isTTY: true }), null);
});

test('getContextUsage prefers used_percentage and falls back to tokens', () => {
  const window = { context_window_size: 200_000, current_usage: usage(30_000, 5_000, 5_000) };
  assert.deepEqual(getContextUsage({ context_window: { ...window, used_percentage: 21.6 } }), { percent: 22, tokens: 40_000, size: 200_000 });
  // 0 or null arrives before the first response even though current_usage is real.
  assert.equal(getContextUsage({ context_window: { ...window, used_percentage: 0 } }).percent, 20);
  assert.equal(getContextUsage({ context_window: { ...window, used_percentage: null } }).percent, 20);
  assert.equal(getContextUsage({ context_window: { used_percentage: 250 } }).percent, 100);
  assert.deepEqual(getContextUsage({}), { percent: 0, tokens: 0, size: 0 });
});

test('getContextUsage uses the transcript size only when stdin reports nothing', () => {
  const empty = { context_window: { context_window_size: 200_000, used_percentage: null, current_usage: null } };
  assert.equal(isContextUnreported(empty), true);
  assert.equal(getContextUsage(empty, null, 50_000).percent, 25);

  const live = { context_window: { context_window_size: 200_000, current_usage: usage(10_000) } };
  assert.equal(isContextUnreported(live), false);
  assert.equal(getContextUsage(live, null, 50_000).percent, 5);
});

test('getContextUsage measures against autoCompactWindow when set', () => {
  const stdin = { context_window: { context_window_size: 1_000_000, used_percentage: 9, current_usage: usage(80_000) } };
  assert.deepEqual(getContextUsage(stdin, 160_000), { percent: 50, tokens: 80_000, size: 160_000 });
});

test('getUsageFromStdin reads the 5-hour and 7-day windows', () => {
  assert.equal(getUsageFromStdin({}), null);
  assert.equal(getUsageFromStdin({ rate_limits: { five_hour: { used_percentage: 'x' } } }), null);
  assert.deepEqual(getUsageFromStdin({
    rate_limits: {
      five_hour: { used_percentage: 25.4, resets_at: 1_790_000_000 },
      seven_day: { used_percentage: 140, resets_at: -1 },
    },
  }), {
    fiveHour: 25,
    sevenDay: 100,
    fiveHourResetAt: new Date(1_790_000_000_000),
    sevenDayResetAt: null,
  });
});

test('model name, source, and format', () => {
  assert.equal(getModelName({ model: { display_name: ' Opus 5.5 ', id: 'claude-opus-5-5' } }), 'Opus 5.5');
  assert.equal(getModelName({ model: { id: 'claude-opus-5-5' } }), 'claude-opus-5-5');
  assert.equal(getModelName({}), 'Unknown');

  const stdin = { model: { display_name: 'Opus 5.5' } };
  assert.equal(resolveModelName(stdin, { lastAssistantModel: 'glm-5' }), 'Opus 5.5');
  assert.equal(resolveModelName(stdin, { lastAssistantModel: 'glm-5' }, 'transcript'), 'glm-5');
  assert.equal(resolveModelName(stdin, { lastAssistantModel: 'glm-5' }, 'auto'), 'glm-5');
  assert.equal(resolveModelName(stdin, { lastAssistantModel: 'claude-opus-5-5' }, 'auto'), 'Opus 5.5');
  assert.equal(resolveModelName(stdin, { lastAssistantModel: '\x1b[31mevil' }, 'transcript'), 'evil');

  assert.equal(formatModelName('Claude Opus 5.5 (1M context)', 'full'), 'Claude Opus 5.5 (1M context)');
  assert.equal(formatModelName('Claude Opus 5.5 (1M context)', 'compact'), 'Claude Opus 5.5');
  assert.equal(formatModelName('Claude Opus 5.5 (1M context)', 'short'), 'Opus 5.5');
  assert.equal(formatModelName('Opus', 'short', 'Mine'), 'Mine');
});

test('getProviderLabel detects routed and enterprise providers', () => {
  assert.equal(getProviderLabel({}, { CLAUDE_CODE_USE_BEDROCK: '1' }), 'Bedrock');
  assert.equal(getProviderLabel({}, { CLAUDE_CODE_USE_VERTEX: '1' }), 'Vertex');
  assert.equal(getProviderLabel({}, { ANTHROPIC_BASE_URL: 'https://api.minimax.io/anthropic/' }), 'MiniMax');
  assert.equal(getProviderLabel({ model: { id: 'opusplan' } }, {}), 'Enterprise');
  assert.equal(getProviderLabel({}, { ANTHROPIC_BASE_URL: 'not a url' }), null);
});

test('stdinText sanitizes and bounds free text', () => {
  assert.equal(stdinText('\x1b]8;;https://x\x07Fix\x1b[31m it‮  '), 'Fix it');
  assert.equal(stdinText('abcdef', 3), 'abc');
  assert.equal(stdinText('   '), undefined);
  assert.equal(stdinText(42), undefined);
});

test('getNativeCostUsd hides routed providers unless opted in', () => {
  const cost = (total, id) => ({ cost: { total_cost_usd: total }, model: { id } });
  assert.equal(getNativeCostUsd(cost(1.5, 'claude-opus-5-5')), 1.5);
  assert.equal(getNativeCostUsd(cost(Number.NaN, 'claude-opus-5-5')), null);
  assert.equal(getNativeCostUsd(cost(1.5, 'us.anthropic.claude-opus-5-5-v1:0')), null);
  assert.equal(getNativeCostUsd(cost(1.5, 'claude-opus-5-5@20260101'), { allowRoutedCost: true }), 1.5);
  assert.equal(getNativeCostUsd(cost(0, 'claude-opus-5-5@20260101'), { allowRoutedCost: true }), null);
  assert.deepEqual([formatUsd(12.345), formatUsd(0.1234), formatUsd(0.01234)], ['$12.35', '$0.123', '$0.0123']);
});
