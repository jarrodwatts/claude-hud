import { describe, test, it } from 'node:test';
import assert from 'node:assert/strict';
import { readStdin, parseRateLimits } from '../dist/stdin.js';

test('readStdin returns null for TTY input', async () => {
  const originalIsTTY = process.stdin.isTTY;
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

  try {
    const result = await readStdin();
    assert.equal(result, null);
  } finally {
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
  }
});

test('readStdin returns null on stream errors', async () => {
  const originalIsTTY = process.stdin.isTTY;
  const originalSetEncoding = process.stdin.setEncoding;
  Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
  process.stdin.setEncoding = () => {
    throw new Error('boom');
  };

  try {
    const result = await readStdin();
    assert.equal(result, null);
  } finally {
    process.stdin.setEncoding = originalSetEncoding;
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
  }
});

describe('parseRateLimits', () => {
  it('returns null when rate_limits is absent', () => {
    assert.equal(parseRateLimits({}), null);
  });

  it('returns null when rate_limits has no windows', () => {
    assert.equal(parseRateLimits({ rate_limits: {} }), null);
  });

  it('parses both windows', () => {
    const result = parseRateLimits({
      rate_limits: {
        five_hour: { used_percentage: 23.5, resets_at: 1738425600 },
        seven_day: { used_percentage: 41.2, resets_at: 1738857600 },
      },
    });
    assert.equal(result.planName, 'Pro');
    assert.equal(result.fiveHour, 23.5);
    assert.equal(result.sevenDay, 41.2);
    assert.ok(result.fiveHourResetAt instanceof Date);
    assert.equal(result.fiveHourResetAt.getTime(), 1738425600 * 1000);
    assert.equal(result.sevenDayResetAt.getTime(), 1738857600 * 1000);
  });

  it('handles five_hour only', () => {
    const result = parseRateLimits({
      rate_limits: {
        five_hour: { used_percentage: 80, resets_at: 1738425600 },
      },
    });
    assert.equal(result.fiveHour, 80);
    assert.equal(result.sevenDay, null);
    assert.equal(result.sevenDayResetAt, null);
  });

  it('handles seven_day only', () => {
    const result = parseRateLimits({
      rate_limits: {
        seven_day: { used_percentage: 50, resets_at: 1738857600 },
      },
    });
    assert.equal(result.fiveHour, null);
    assert.equal(result.sevenDay, 50);
  });

  it('handles 100% (limit reached)', () => {
    const result = parseRateLimits({
      rate_limits: {
        five_hour: { used_percentage: 100, resets_at: 1738425600 },
        seven_day: { used_percentage: 100, resets_at: 1738857600 },
      },
    });
    assert.equal(result.fiveHour, 100);
    assert.equal(result.sevenDay, 100);
  });

  it('handles 0% usage', () => {
    const result = parseRateLimits({
      rate_limits: {
        five_hour: { used_percentage: 0, resets_at: 1738425600 },
        seven_day: { used_percentage: 0, resets_at: 1738857600 },
      },
    });
    assert.equal(result.fiveHour, 0);
    assert.equal(result.sevenDay, 0);
  });
});
