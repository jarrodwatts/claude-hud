import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateSessionCost, resolveSessionCost, formatUsd } from '../dist/cost.js';

test('estimateSessionCost returns null when sessionTokens is undefined', () => {
  assert.equal(estimateSessionCost({ model: { display_name: 'Claude Opus 4' } }, undefined), null);
});

test('estimateSessionCost returns null for Bedrock model IDs', () => {
  const tokens = { inputTokens: 1000, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0 };
  const result = estimateSessionCost({ model: { id: 'us.anthropic.claude-sonnet-4-20250514-v1:0' } }, tokens);
  assert.equal(result, null);
});

test('estimateSessionCost returns null for Vertex model IDs', () => {
  const tokens = { inputTokens: 1000, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0 };
  const result = estimateSessionCost({ model: { id: 'publishers/anthropic/models/claude-sonnet-4@20250514' } }, tokens);
  assert.equal(result, null);
});

test('estimateSessionCost estimates Bedrock cost when allowRoutedCost is set', () => {
  const tokens = { inputTokens: 1000000, outputTokens: 1000000, cacheCreationTokens: 0, cacheReadTokens: 0 };
  const result = estimateSessionCost(
    { model: { id: 'us.anthropic.claude-sonnet-4-20250514-v1:0' } },
    tokens,
    { allowRoutedCost: true },
  );
  assert.ok(result);
  // Sonnet 4 pricing: 1M * $3/M input, 1M * $15/M output
  assert.equal(result.inputUsd, 3);
  assert.equal(result.outputUsd, 15);
});

test('estimateSessionCost estimates Vertex cost when allowRoutedCost is set', () => {
  const tokens = { inputTokens: 1000000, outputTokens: 1000000, cacheCreationTokens: 0, cacheReadTokens: 0 };
  const result = estimateSessionCost(
    { model: { id: 'publishers/anthropic/models/claude-sonnet-4@20250514' } },
    tokens,
    { allowRoutedCost: true },
  );
  assert.ok(result);
  assert.equal(result.inputUsd, 3);
  assert.equal(result.outputUsd, 15);
});

test('estimateSessionCost returns null when no model matches pricing', () => {
  const tokens = { inputTokens: 1000, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0 };
  const result = estimateSessionCost({ model: { display_name: 'Unknown Model XYZ' } }, tokens);
  assert.equal(result, null);
});

test('estimateSessionCost returns null when total tokens are zero', () => {
  const tokens = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
  const result = estimateSessionCost({ model: { display_name: 'Claude Sonnet 4' } }, tokens);
  assert.equal(result, null);
});

test('estimateSessionCost calculates correctly for Sonnet 4', () => {
  const tokens = { inputTokens: 100000, outputTokens: 50000, cacheCreationTokens: 0, cacheReadTokens: 0 };
  const result = estimateSessionCost({ model: { display_name: 'Claude Sonnet 4' } }, tokens);
  assert.ok(result);
  // input: 100k * $3/M = $0.30, output: 50k * $15/M = $0.75
  assert.equal(result.inputUsd, 0.3);
  assert.equal(result.outputUsd, 0.75);
  assert.equal(result.totalUsd, 1.05);
});

test('estimateSessionCost calculates cache costs correctly', () => {
  const tokens = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 1000000, cacheReadTokens: 1000000 };
  const result = estimateSessionCost({ model: { display_name: 'Claude Sonnet 4' } }, tokens);
  assert.ok(result);
  // cache creation: 1M * $3 * 1.25 / M = $3.75
  // cache read: 1M * $3 * 0.1 / M = $0.30 (floating point)
  assert.equal(result.cacheCreationUsd, 3.75);
  assert.ok(Math.abs(result.cacheReadUsd - 0.3) < 1e-10);
  assert.ok(Math.abs(result.totalUsd - 4.05) < 1e-10);
});

test('estimateSessionCost matches model from id when display_name fails', () => {
  const tokens = { inputTokens: 1000000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
  const result = estimateSessionCost({ model: { display_name: 'Unknown', id: 'claude-sonnet-3.5-20241022' } }, tokens);
  assert.ok(result);
  // Sonnet 3.5: $3/M input
  assert.equal(result.inputUsd, 3);
});

test('estimateSessionCost prices enterprise plan aliases', () => {
  const tokens = { inputTokens: 1000000, outputTokens: 1000000, cacheCreationTokens: 0, cacheReadTokens: 0 };

  const opusPlan = estimateSessionCost({ model: { display_name: 'opusplan' } }, tokens);
  assert.ok(opusPlan);
  assert.equal(opusPlan.inputUsd, 15);
  assert.equal(opusPlan.outputUsd, 75);

  const sonnetPlan = estimateSessionCost({ model: { display_name: 'sonnetplan' } }, tokens);
  assert.ok(sonnetPlan);
  assert.equal(sonnetPlan.inputUsd, 3);
  assert.equal(sonnetPlan.outputUsd, 15);

  const haikuPlan = estimateSessionCost({ model: { display_name: 'haikuplan' } }, tokens);
  assert.ok(haikuPlan);
  assert.equal(haikuPlan.inputUsd, 0.8);
  assert.equal(haikuPlan.outputUsd, 4);
});

test('estimateSessionCost prices Sonnet 3.7', () => {
  const tokens = { inputTokens: 1000000, outputTokens: 1000000, cacheCreationTokens: 0, cacheReadTokens: 0 };
  const result = estimateSessionCost({ model: { display_name: 'Claude Sonnet 3.7' } }, tokens);
  assert.ok(result);
  assert.equal(result.inputUsd, 3);
  assert.equal(result.outputUsd, 15);
});

test('resolveSessionCost prefers native cost', () => {
  const stdin = {
    model: { display_name: 'Claude Opus 4' },
    cost: { total_cost_usd: 5.0 },
  };
  const result = resolveSessionCost(stdin, undefined);
  assert.deepEqual(result, { totalUsd: 5.0, source: 'native' });
});

test('resolveSessionCost ignores native cost for Bedrock models', () => {
  const stdin = {
    model: { id: 'us.anthropic.claude-sonnet-4-20250514-v1:0', display_name: 'Sonnet' },
    cost: { total_cost_usd: 1.0 },
  };
  const tokens = { inputTokens: 1000, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0 };
  const result = resolveSessionCost(stdin, tokens);
  // Should be null since Bedrock is excluded from estimation too
  assert.equal(result, null);
});

test('resolveSessionCost ignores native cost for Vertex models', () => {
  const stdin = {
    model: { id: 'publishers/anthropic/models/claude-sonnet-4@20250514', display_name: 'Sonnet' },
    cost: { total_cost_usd: 2.0 },
  };
  const tokens = { inputTokens: 1000, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0 };
  const result = resolveSessionCost(stdin, tokens);
  assert.equal(result, null);
});

test('resolveSessionCost estimates routed provider cost when allowRoutedCost is set', () => {
  const stdin = { model: { id: 'us.anthropic.claude-sonnet-4-20250514-v1:0', display_name: 'Sonnet' } };
  const tokens = { inputTokens: 1000000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
  const result = resolveSessionCost(stdin, tokens, { allowRoutedCost: true });
  assert.ok(result);
  assert.equal(result.source, 'estimate');
  assert.equal(result.totalUsd, 3);
});

test('resolveSessionCost prefers positive native cost for routed providers when allowRoutedCost is set', () => {
  const stdin = {
    model: { id: 'us.anthropic.claude-sonnet-4-20250514-v1:0', display_name: 'Sonnet' },
    cost: { total_cost_usd: 2.54 },
  };
  const tokens = { inputTokens: 1000000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
  const result = resolveSessionCost(stdin, tokens, { allowRoutedCost: true });
  assert.ok(result);
  assert.equal(result.source, 'native');
  assert.equal(result.totalUsd, 2.54);
});

test('resolveSessionCost falls back to estimate when routed native cost is zero', () => {
  const stdin = {
    model: { id: 'us.anthropic.claude-sonnet-4-20250514-v1:0', display_name: 'Sonnet' },
    cost: { total_cost_usd: 0 },
  };
  const tokens = { inputTokens: 1000000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
  const result = resolveSessionCost(stdin, tokens, { allowRoutedCost: true });
  assert.ok(result);
  // $0.00 is unreliable at session start, so fall back to the estimate
  assert.equal(result.source, 'estimate');
  assert.equal(result.totalUsd, 3);
});

test('resolveSessionCost falls back to estimate when native cost is NaN', () => {
  const stdin = {
    model: { display_name: 'Claude Sonnet 4' },
    cost: { total_cost_usd: NaN },
  };
  const tokens = { inputTokens: 100000, outputTokens: 50000, cacheCreationTokens: 0, cacheReadTokens: 0 };
  const result = resolveSessionCost(stdin, tokens);
  assert.ok(result);
  assert.equal(result.source, 'estimate');
});

test('resolveSessionCost returns null when no native cost and no estimate', () => {
  const stdin = {
    model: { display_name: 'Unknown Model' },
  };
  const tokens = { inputTokens: 1000, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0 };
  const result = resolveSessionCost(stdin, tokens);
  assert.equal(result, null);
});

test('resolveSessionCost returns null when native cost is null', () => {
  const stdin = {
    model: { display_name: 'Unknown Model' },
    cost: { total_cost_usd: null },
  };
  const result = resolveSessionCost(stdin, undefined);
  assert.equal(result, null);
});

test('formatUsd formats different ranges correctly', () => {
  assert.equal(formatUsd(10.5), '$10.50');
  assert.equal(formatUsd(1.0), '$1.00');
  assert.equal(formatUsd(0.5), '$0.500');
  assert.equal(formatUsd(0.1), '$0.100');
  assert.equal(formatUsd(0.05), '$0.0500');
  assert.equal(formatUsd(0.001), '$0.0010');
  assert.equal(formatUsd(0.0001), '$0.0001');
});

test('estimateSessionCost handles model with no display_name and no id', () => {
  const tokens = { inputTokens: 1000, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0 };
  const result = estimateSessionCost({ model: {} }, tokens);
  assert.equal(result, null);
});

test('estimateSessionCost handles model being undefined', () => {
  const tokens = { inputTokens: 1000, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0 };
  const result = estimateSessionCost({}, tokens);
  assert.equal(result, null);
});
