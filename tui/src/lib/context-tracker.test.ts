import { describe, it, expect, beforeEach } from 'vitest';
import { ContextTracker } from './context-tracker.js';
import type { HudEvent } from './types.js';

describe('ContextTracker', () => {
  let tracker: ContextTracker;

  beforeEach(() => {
    tracker = new ContextTracker();
  });

  describe('estimateTokens', () => {
    it('should return 0 for empty string', () => {
      expect(tracker.estimateTokens('')).toBe(0);
    });

    it('should estimate ~4 chars per token', () => {
      const text = 'a'.repeat(100);
      expect(tracker.estimateTokens(text)).toBe(25);
    });

    it('should round up token estimates', () => {
      const text = 'a'.repeat(7);
      expect(tracker.estimateTokens(text)).toBe(2);
    });
  });

  describe('processEvent', () => {
    it('should track input tokens', () => {
      const event: HudEvent = {
        event: 'PostToolUse',
        tool: 'Read',
        input: { file_path: '/path/to/file.ts' },
        response: null,
        session: 'test',
        ts: Date.now() / 1000,
      };

      tracker.processEvent(event);
      const health = tracker.getHealth();

      expect(health.breakdown.toolInputs).toBeGreaterThan(0);
    });

    it('should track output tokens', () => {
      const event: HudEvent = {
        event: 'PostToolUse',
        tool: 'Read',
        input: null,
        response: { content: 'x'.repeat(400) },
        session: 'test',
        ts: Date.now() / 1000,
      };

      tracker.processEvent(event);
      const health = tracker.getHealth();

      expect(health.breakdown.toolOutputs).toBeGreaterThan(0);
    });
  });

  describe('getHealth', () => {
    it('should return initial healthy state', () => {
      const health = tracker.getHealth();

      expect(health.tokens).toBe(0);
      expect(health.percent).toBe(0);
      expect(health.status).toBe('healthy');
      expect(health.shouldCompact).toBe(false);
    });

    it('should calculate percent correctly', () => {
      for (let i = 0; i < 100; i++) {
        tracker.processEvent({
          event: 'PostToolUse',
          tool: 'Read',
          input: null,
          response: { content: 'x'.repeat(8000) },
          session: 'test',
          ts: Date.now() / 1000,
        });
      }

      const health = tracker.getHealth();
      expect(health.percent).toBeGreaterThan(0);
      expect(health.percent).toBeLessThanOrEqual(100);
    });

    it('should set warning status at 70%', () => {
      // Add tokens to get to ~75% (150k out of 200k = 75%)
      // Each response is ~2500 tokens (10000 chars / 4)
      for (let i = 0; i < 60; i++) {
        tracker.processEvent({
          event: 'PostToolUse',
          tool: 'Read',
          input: null,
          response: { content: 'x'.repeat(10000) },
          session: 'test',
          ts: Date.now() / 1000,
        });
      }

      const health = tracker.getHealth();
      expect(health.status).toBe('warning');
      expect(health.percent).toBeGreaterThanOrEqual(70);
      expect(health.percent).toBeLessThan(85);
    });
  });

  describe('addMessageTokens', () => {
    it('should add tokens to messages breakdown', () => {
      tracker.addMessageTokens(100);
      const health = tracker.getHealth();

      expect(health.breakdown.messages).toBe(100);
      expect(health.tokens).toBe(100);
    });

    it('should accumulate message tokens', () => {
      tracker.addMessageTokens(50);
      tracker.addMessageTokens(75);
      const health = tracker.getHealth();

      expect(health.breakdown.messages).toBe(125);
      expect(health.tokens).toBe(125);
    });
  });

  describe('getContextState', () => {
    it('should return a subset of health data', () => {
      const state = tracker.getContextState();

      expect(state).toHaveProperty('tokens');
      expect(state).toHaveProperty('percent');
      expect(state).toHaveProperty('remaining');
      expect(state).toHaveProperty('maxTokens');
      expect(Object.keys(state)).toHaveLength(4);
    });

    it('should reflect current token count', () => {
      tracker.processEvent({
        event: 'PostToolUse',
        tool: 'Read',
        input: null,
        response: { content: 'x'.repeat(400) },
        session: 'test',
        ts: Date.now() / 1000,
      });

      const state = tracker.getContextState();
      expect(state.tokens).toBeGreaterThan(0);
      expect(state.remaining).toBeLessThan(state.maxTokens);
    });
  });

  describe('reset', () => {
    it('should reset all counters', () => {
      tracker.processEvent({
        event: 'PostToolUse',
        tool: 'Read',
        input: { test: true },
        response: { content: 'test' },
        session: 'test',
        ts: Date.now() / 1000,
      });

      tracker.reset();
      const health = tracker.getHealth();

      expect(health.tokens).toBe(0);
      expect(health.breakdown.toolInputs).toBe(0);
      expect(health.breakdown.toolOutputs).toBe(0);
    });
  });

  describe('getTokenHistory', () => {
    it('should return empty array when no events processed', () => {
      // #given - fresh tracker
      // #when
      const history = tracker.getTokenHistory();
      // #then
      expect(history).toEqual([]);
    });

    it('should track token history as events are processed', () => {
      // #given
      const events = [
        { content: 'x'.repeat(100) },
        { content: 'x'.repeat(200) },
        { content: 'x'.repeat(300) },
      ];

      // #when
      events.forEach((response, i) => {
        tracker.processEvent({
          event: 'PostToolUse',
          tool: 'Read',
          input: null,
          response,
          session: 'test',
          ts: Date.now() / 1000 + i,
        });
      });

      // #then
      const history = tracker.getTokenHistory();
      expect(history.length).toBe(3);
      expect(history[0]).toBeLessThan(history[1]);
      expect(history[1]).toBeLessThan(history[2]);
    });

    it('should include tokenHistory in getHealth output', () => {
      // #given
      tracker.processEvent({
        event: 'PostToolUse',
        tool: 'Read',
        input: null,
        response: { content: 'test' },
        session: 'test',
        ts: Date.now() / 1000,
      });

      // #when
      const health = tracker.getHealth();

      // #then
      expect(health.tokenHistory).toBeDefined();
      expect(Array.isArray(health.tokenHistory)).toBe(true);
      expect(health.tokenHistory.length).toBeGreaterThan(0);
    });
  });
});
