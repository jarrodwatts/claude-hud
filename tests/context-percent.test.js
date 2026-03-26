import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getBufferedPercent, getContextPercent } from '../dist/stdin.js';

test('context percent is 0 when usage tokens are explicitly zero (even if native percent is non-zero)', () => {
  const stdin = {
    context_window: {
      context_window_size: 200000,
      used_percentage: 23,
      current_usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  };

  assert.equal(getContextPercent(stdin), 0);
  assert.equal(getBufferedPercent(stdin), 0);
});

test('native percent is still used when usage token fields are missing', () => {
  const stdin = {
    context_window: {
      context_window_size: 200000,
      used_percentage: 23,
      current_usage: null,
    },
  };

  assert.equal(getContextPercent(stdin), 23);
  assert.equal(getBufferedPercent(stdin), 23);
});
