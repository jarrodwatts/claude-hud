import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import type { HudState } from './hooks/useHudState.js';
import { App } from './app.js';
let mockState: HudState;

vi.mock('./hooks/useHudState.js', () => ({
  useHudState: () => mockState,
}));

vi.mock('./hooks/useElapsedTime.js', () => ({
  useElapsedTime: () => '00:00',
}));

const baseState: HudState = {
  tools: [],
  todos: [],
  context: {
    tokens: 0,
    percent: 0,
    remaining: 200000,
    maxTokens: 200000,
    burnRate: 0,
    status: 'healthy',
    shouldCompact: false,
    breakdown: {
      toolOutputs: 0,
      toolInputs: 0,
      messages: 0,
      other: 0,
    },
    sessionStart: 0,
    lastUpdate: 0,
    tokenHistory: [],
  },
  agents: [],
  sessionInfo: {
    sessionId: 's1',
    permissionMode: 'default',
    cwd: '/tmp',
    transcriptPath: '',
    isIdle: true,
  },
  sessionPhase: 'active',
  safeMode: false,
  safeModeReason: null,
  errors: [],
  parseErrorCount: 0,
  settings: null,
  contextFiles: null,
  connectionStatus: 'connected',
  cost: {
    inputCost: 0,
    outputCost: 0,
    totalCost: 0,
    inputTokens: 0,
    outputTokens: 0,
  },
  model: null,
  config: null,
  now: 0,
};

describe('App schema mismatch banner', () => {
  beforeEach(() => {
    mockState = { ...baseState };
  });

  it('renders schema mismatch guidance', async () => {
    mockState = {
      ...baseState,
      errors: [
        {
          code: 'schema_version_mismatch',
          message: 'Schema version 2 is newer than supported 1',
          ts: 1000,
          context: { schemaVersion: 2, expected: 1 },
        },
      ],
    };

    const { lastFrame, unmount } = render(<App sessionId="s1" fifoPath="/tmp/test.fifo" />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Schema mismatch');
    expect(frame).toContain('v2 (expected v1)');
    expect(frame).toContain('Update claude-hud');
    unmount();
  });

  it('suppresses the banner after the timeout', async () => {
    mockState = {
      ...baseState,
      errors: [
        {
          code: 'schema_version_mismatch',
          message: 'Schema version 2 is newer than supported 1',
          ts: 1000,
          context: { schemaVersion: 2, expected: 1 },
        },
      ],
    };

    const { lastFrame, rerender, unmount } = render(
      <App
        sessionId="s1"
        fifoPath="/tmp/test.fifo"
        schemaBannerVisibleMs={5}
        schemaBannerSuppressMs={15}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(lastFrame()).toContain('Schema mismatch');

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(lastFrame()).not.toContain('Schema mismatch');

    mockState = {
      ...baseState,
      errors: [
        {
          code: 'schema_version_mismatch',
          message: 'Schema version 3 is newer than supported 1',
          ts: 2000,
          context: { schemaVersion: 3, expected: 1 },
        },
      ],
    };
    rerender(
      <App
        sessionId="s1"
        fifoPath="/tmp/test.fifo"
        schemaBannerVisibleMs={5}
        schemaBannerSuppressMs={15}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(lastFrame()).not.toContain('Schema mismatch');

    await new Promise((resolve) => setTimeout(resolve, 20));

    mockState = {
      ...baseState,
      errors: [
        {
          code: 'schema_version_mismatch',
          message: 'Schema version 4 is newer than supported 1',
          ts: 3000,
          context: { schemaVersion: 4, expected: 1 },
        },
      ],
    };
    rerender(
      <App
        sessionId="s1"
        fifoPath="/tmp/test.fifo"
        schemaBannerVisibleMs={5}
        schemaBannerSuppressMs={15}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(lastFrame()).toContain('Schema mismatch');

    unmount();
  });
});
