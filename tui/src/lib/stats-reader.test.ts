import { describe, it, expect } from 'vitest';
import { formatTokens } from './stats-reader.js';

describe('formatTokens', () => {
  it('should return raw number for values under 1000', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(1)).toBe('1');
    expect(formatTokens(999)).toBe('999');
  });

  it('should format thousands with k suffix', () => {
    expect(formatTokens(1000)).toBe('1.0k');
    expect(formatTokens(1500)).toBe('1.5k');
    expect(formatTokens(10000)).toBe('10.0k');
    expect(formatTokens(999999)).toBe('1000.0k');
  });

  it('should format millions with M suffix', () => {
    expect(formatTokens(1000000)).toBe('1.0M');
    expect(formatTokens(1500000)).toBe('1.5M');
    expect(formatTokens(10000000)).toBe('10.0M');
    expect(formatTokens(123456789)).toBe('123.5M');
  });

  it('should handle edge cases at boundaries', () => {
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1000)).toBe('1.0k');
    expect(formatTokens(999999)).toBe('1000.0k');
    expect(formatTokens(1000000)).toBe('1.0M');
  });

  it('should handle decimal rounding', () => {
    expect(formatTokens(1234)).toBe('1.2k');
    expect(formatTokens(1250)).toBe('1.3k');
    expect(formatTokens(1249)).toBe('1.2k');
  });
});
