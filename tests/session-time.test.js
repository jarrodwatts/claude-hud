import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSessionTimeLine } from '../dist/render/lines/session-time.js';

function makeCtx(overrides = {}) {
  return {
    stdin: {},
    transcript: {
      tools: [],
      agents: [],
      todos: [],
      ...(overrides.transcript || {}),
    },
    claudeMdCount: 0,
    rulesCount: 0,
    mcpCount: 0,
    hooksCount: 0,
    sessionDuration: '',
    gitStatus: null,
    usageData: null,
    memoryUsage: null,
    config: {
      display: {
        showSessionStartDate: false,
        showLastResponseAt: false,
        ...(overrides.display || {}),
      },
      ...(overrides.config || {}),
    },
    extraLabel: null,
    ...(overrides.ctx || {}),
  };
}

test('returns null when both toggles are off', () => {
  const ctx = makeCtx({
    transcript: {
      sessionStart: new Date('2026-05-08T09:14:00Z'),
      lastAssistantResponseAt: new Date('2026-05-08T10:00:00Z'),
    },
  });
  const result = renderSessionTimeLine(ctx);
  assert.equal(result, null);
});

test('renders session start date when showSessionStartDate is true', () => {
  const startDate = new Date(2026, 4, 8, 9, 14, 0); // local time
  const ctx = makeCtx({
    display: { showSessionStartDate: true },
    transcript: {
      sessionStart: startDate,
    },
  });
  const result = renderSessionTimeLine(ctx);
  assert.ok(result);
  assert.ok(result.includes('Started:'));
  assert.ok(result.includes('2026-05-08 09:14'));
});

test('renders last response relative time when showLastResponseAt is true', () => {
  const lastReply = new Date(2026, 4, 8, 10, 0, 0);
  const now = lastReply.getTime() + 5 * 60 * 1000; // 5 minutes later
  const ctx = makeCtx({
    display: { showLastResponseAt: true },
    transcript: {
      lastAssistantResponseAt: lastReply,
    },
  });
  const result = renderSessionTimeLine(ctx, () => now);
  assert.ok(result);
  assert.ok(result.includes('Last reply:'));
  assert.ok(result.includes('5m ago'));
});

test('renders both when both toggles are on', () => {
  const lastReply = new Date(2026, 4, 8, 11, 30, 0);
  const now = lastReply.getTime() + 30 * 60 * 1000; // 30 minutes later
  const ctx = makeCtx({
    display: { showSessionStartDate: true, showLastResponseAt: true },
    transcript: {
      sessionStart: new Date(2026, 4, 8, 9, 14, 0),
      lastAssistantResponseAt: lastReply,
    },
  });
  const result = renderSessionTimeLine(ctx, () => now);
  assert.ok(result);
  assert.ok(result.includes('Started:'));
  assert.ok(result.includes('Last reply:'));
  assert.ok(result.includes('30m ago'));
});

test('returns null when showSessionStartDate is true but no sessionStart', () => {
  const ctx = makeCtx({
    display: { showSessionStartDate: true },
    transcript: {},
  });
  const result = renderSessionTimeLine(ctx);
  assert.equal(result, null);
});

test('returns null when showLastResponseAt is true but no lastAssistantResponseAt', () => {
  const ctx = makeCtx({
    display: { showLastResponseAt: true },
    transcript: {},
  });
  const result = renderSessionTimeLine(ctx);
  assert.equal(result, null);
});

test('formats hours correctly for last response', () => {
  const lastReply = new Date(2026, 4, 8, 12, 0, 0);
  const now = lastReply.getTime() + (2 * 60 + 30) * 60 * 1000; // 2h 30m later
  const ctx = makeCtx({
    display: { showLastResponseAt: true },
    transcript: {
      lastAssistantResponseAt: lastReply,
    },
  });
  const result = renderSessionTimeLine(ctx, () => now);
  assert.ok(result);
  assert.ok(result.includes('2h 30m ago'));
});

test('formats days correctly for last response', () => {
  const lastReply = new Date(2026, 4, 8, 10, 0, 0);
  const now = lastReply.getTime() + 2 * 24 * 60 * 60 * 1000; // 2 days later
  const ctx = makeCtx({
    display: { showLastResponseAt: true },
    transcript: {
      lastAssistantResponseAt: lastReply,
    },
  });
  const result = renderSessionTimeLine(ctx, () => now);
  assert.ok(result);
  assert.ok(result.includes('2d ago'));
});

test('formats seconds for very recent last response', () => {
  const lastReply = new Date(2026, 4, 8, 10, 0, 0);
  const now = lastReply.getTime() + 45 * 1000; // 45 seconds later
  const ctx = makeCtx({
    display: { showLastResponseAt: true },
    transcript: {
      lastAssistantResponseAt: lastReply,
    },
  });
  const result = renderSessionTimeLine(ctx, () => now);
  assert.ok(result);
  assert.ok(result.includes('45s ago'));
});
