import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import type { HudState } from './hooks/useHudState.js';
import { App } from './app.js';

const mockState: HudState = {
  tools: [
    {
      id: 'tool-1',
      tool: 'Read',
      target: 'README.md',
      status: 'complete',
      ts: 1700000000,
      startTs: 1700000000000,
      endTs: 1700000000500,
      duration: 500,
    },
  ],
  todos: [{ content: 'Add fixture test coverage', status: 'in_progress' }],
  context: {
    tokens: 12000,
    percent: 42,
    remaining: 16000,
    maxTokens: 28000,
    burnRate: 123,
    status: 'healthy',
    shouldCompact: false,
    breakdown: {
      toolOutputs: 2000,
      toolInputs: 1000,
      messages: 8000,
      other: 1000,
    },
    sessionStart: 1700000000000,
    lastUpdate: 1700000005000,
    tokenHistory: [1000, 2000, 3500, 5000, 6500, 8200, 10000, 12000],
  },
  agents: [
    {
      id: 'agent-1',
      type: 'Research',
      description: '',
      status: 'complete',
      startTs: 1000,
      endTs: 7000,
      tools: [],
    },
  ],
  sessionInfo: {
    sessionId: 's1',
    permissionMode: 'default',
    cwd: '/Users/jarrod/claude-hud',
    transcriptPath: '',
    isIdle: false,
  },
  sessionPhase: 'active',
  safeMode: false,
  safeModeReason: null,
  errors: [],
  parseErrorCount: 0,
  config: null,
  now: 1700000006000,
  settings: {
    model: 'claude-sonnet-4',
    pluginCount: 3,
    pluginNames: ['claude-hud'],
    mcpCount: 1,
    mcpNames: ['context7'],
    allowedPermissions: ['filesystem:read'],
  },
  contextFiles: {
    globalClaudeMd: true,
    projectClaudeMd: true,
    projectClaudeMdPath: '/Users/jarrod/claude-hud/CLAUDE.md',
    projectSettings: true,
    projectSettingsRules: 2,
  },
  connectionStatus: 'connected',
  cost: {
    inputCost: 0.2,
    outputCost: 0.4,
    totalCost: 0.6,
    inputTokens: 12000,
    outputTokens: 8000,
  },
  model: 'claude-sonnet-4',
};

vi.mock('./hooks/useHudState.js', () => ({
  useHudState: () => mockState,
}));

vi.mock('./hooks/useElapsedTime.js', () => ({
  useElapsedTime: () => '00:42',
}));

function normalizeFrame(frame: string): string {
  return frame.replace(/[ \t]+$/gm, '');
}

describe('App fixture rendering', () => {
  it('renders a stable HUD frame', () => {
    const { lastFrame, unmount } = render(<App sessionId="s1" fifoPath="/tmp/test.fifo" />);
    const frame = normalizeFrame(lastFrame() ?? '');
    expect(frame).toMatchSnapshot();
    unmount();
  });
});
