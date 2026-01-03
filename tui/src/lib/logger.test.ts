import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { logger } from './logger.js';

describe('logger', () => {
  const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    consoleSpy.mockClear();
  });

  afterAll(() => {
    logger.close();
  });

  it('should have debug, warn, error, and close methods', () => {
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.close).toBe('function');
  });

  it('should accept context, message, and optional data', () => {
    expect(() => logger.debug('Context', 'Message')).not.toThrow();
    expect(() => logger.debug('Context', 'Message', { data: 'test' })).not.toThrow();
    expect(() => logger.warn('Context', 'Message')).not.toThrow();
    expect(() => logger.warn('Context', 'Message', new Error('test'))).not.toThrow();
    expect(() => logger.error('Context', 'Message')).not.toThrow();
    expect(() => logger.error('Context', 'Message', new Error('test'))).not.toThrow();
  });

  it('should not throw with null or undefined data', () => {
    expect(() => logger.debug('Context', 'Message', null)).not.toThrow();
    expect(() => logger.debug('Context', 'Message', undefined)).not.toThrow();
    expect(() => logger.warn('Context', 'Message', null)).not.toThrow();
    expect(() => logger.error('Context', 'Message', null)).not.toThrow();
  });

  it('should not throw with various data types', () => {
    expect(() => logger.debug('Context', 'Message', 'string')).not.toThrow();
    expect(() => logger.debug('Context', 'Message', 123)).not.toThrow();
    expect(() => logger.debug('Context', 'Message', { nested: { value: 1 } })).not.toThrow();
    expect(() => logger.debug('Context', 'Message', [1, 2, 3])).not.toThrow();
  });

  it('should not throw with circular data', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => logger.error('Context', 'Message', circular)).not.toThrow();
  });
});
