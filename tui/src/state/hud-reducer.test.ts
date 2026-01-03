import { describe, expect, it } from 'vitest';
import { createInitialHudState } from './hud-state.js';
import { reduceHudState } from './hud-reducer.js';
import type { HudEvent } from '../lib/types.js';

function createState() {
  return createInitialHudState({
    context: {
      tokens: 0,
      percent: 0,
      remaining: 0,
      maxTokens: 0,
      burnRate: 0,
      status: 'healthy',
      shouldCompact: false,
      breakdown: { toolOutputs: 0, toolInputs: 0, messages: 0, other: 0 },
      sessionStart: 0,
      lastUpdate: 0,
      tokenHistory: [],
    },
    cost: { inputCost: 0, outputCost: 0, totalCost: 0, inputTokens: 0, outputTokens: 0 },
  });
}

describe('reduceHudState', () => {
  it('tracks tool lifecycle from PreToolUse to PostToolUse', () => {
    const state = createState();
    const preEvent: HudEvent = {
      schemaVersion: 1,
      event: 'PreToolUse',
      tool: 'Read',
      toolUseId: 'tool-1',
      input: { file_path: 'README.md' },
      response: null,
      session: 's1',
      ts: 100,
    };

    const afterPre = reduceHudState(state, { type: 'event', event: preEvent, now: 1000 });
    expect(afterPre.tools).toHaveLength(1);
    expect(afterPre.tools[0]?.status).toBe('running');
    expect(afterPre.sessionInfo.isIdle).toBe(false);
    expect(afterPre.runningTools.has('tool-1')).toBe(true);

    const postEvent: HudEvent = {
      schemaVersion: 1,
      event: 'PostToolUse',
      tool: 'Read',
      toolUseId: 'tool-1',
      input: null,
      response: { duration_ms: 250 },
      session: 's1',
      ts: 100,
    };

    const afterPost = reduceHudState(afterPre, { type: 'event', event: postEvent, now: 1300 });
    expect(afterPost.tools[0]?.status).toBe('complete');
    expect(afterPost.runningTools.has('tool-1')).toBe(false);
    expect(afterPost.tools[0]?.duration).toBe(250);
  });

  it('applies todo updates and agent lifecycle', () => {
    const state = createState();
    const todoEvent: HudEvent = {
      schemaVersion: 1,
      event: 'PreToolUse',
      tool: 'TodoWrite',
      toolUseId: 'todo-1',
      input: { todos: [{ content: 'Ship HUD tests', status: 'in_progress' }] },
      response: null,
      session: 's1',
      ts: 200,
    };
    const afterTodo = reduceHudState(state, { type: 'event', event: todoEvent, now: 2000 });
    expect(afterTodo.todos).toHaveLength(1);

    const taskEvent: HudEvent = {
      schemaVersion: 1,
      event: 'PreToolUse',
      tool: 'Task',
      toolUseId: 'agent-1',
      input: { subagent_type: 'Research', description: 'Check HUD output' },
      response: null,
      session: 's1',
      ts: 300,
    };
    const afterTask = reduceHudState(afterTodo, { type: 'event', event: taskEvent, now: 3000 });
    expect(afterTask.agents).toHaveLength(1);
    expect(afterTask.agents[0]?.status).toBe('running');

    const stopEvent: HudEvent = {
      schemaVersion: 1,
      event: 'SubagentStop',
      tool: null,
      input: null,
      response: null,
      session: 's1',
      ts: 400,
    };
    const afterStop = reduceHudState(afterTask, { type: 'event', event: stopEvent, now: 4000 });
    expect(afterStop.agents[0]?.status).toBe('complete');
  });

  it('handles model action', () => {
    const state = createState();
    const result = reduceHudState(state, { type: 'model', model: 'claude-sonnet-4' });
    expect(result.model).toBe('claude-sonnet-4');
  });

  it('handles tick action', () => {
    const state = createState();
    const result = reduceHudState(state, { type: 'tick', now: 12345 });
    expect(result.now).toBe(12345);
  });

  it('handles error action and limits display count', () => {
    const state = createState();

    let result = state;
    for (let i = 0; i < 15; i++) {
      result = reduceHudState(result, {
        type: 'error',
        error: { type: 'parse_error', message: `Error ${i}`, timestamp: i },
      });
    }

    expect(result.errors.length).toBeLessThanOrEqual(10);
    expect(result.errors[result.errors.length - 1]?.message).toBe('Error 14');
  });

  it('handles parseError action', () => {
    const state = createState();
    expect(state.parseErrorCount).toBe(0);

    const result = reduceHudState(state, { type: 'parseError' });
    expect(result.parseErrorCount).toBe(1);

    const result2 = reduceHudState(result, { type: 'parseError' });
    expect(result2.parseErrorCount).toBe(2);
  });

  it('handles safeMode action', () => {
    const state = createState();
    expect(state.safeMode).toBe(false);

    const result = reduceHudState(state, {
      type: 'safeMode',
      safeMode: true,
      reason: 'Too many errors',
    });
    expect(result.safeMode).toBe(true);
    expect(result.safeModeReason).toBe('Too many errors');

    const result2 = reduceHudState(result, {
      type: 'safeMode',
      safeMode: false,
      reason: null,
    });
    expect(result2.safeMode).toBe(false);
    expect(result2.safeModeReason).toBeNull();
  });

  it('derives connected session phase when isIdle is false', () => {
    const state = createState();
    const result = reduceHudState(state, { type: 'connection', status: 'connected' });
    expect(result.sessionPhase).toBe('idle');
  });

  it('derives error session phase on error status', () => {
    const state = createState();
    const result = reduceHudState(state, { type: 'connection', status: 'error' });
    expect(result.sessionPhase).toBe('error');
  });

  it('handles PostToolUse without prior PreToolUse', () => {
    const state = createState();
    const postEvent: HudEvent = {
      schemaVersion: 1,
      event: 'PostToolUse',
      tool: 'Read',
      toolUseId: 'orphan-tool',
      input: null,
      response: { duration_ms: 100 },
      session: 's1',
      ts: 100,
    };

    const result = reduceHudState(state, { type: 'event', event: postEvent, now: 1000 });
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]?.id).toBe('orphan-tool');
    expect(result.tools[0]?.status).toBe('complete');
  });

  it('handles PostToolUse with error response', () => {
    const state = createState();
    const preEvent: HudEvent = {
      schemaVersion: 1,
      event: 'PreToolUse',
      tool: 'Bash',
      toolUseId: 'failing-tool',
      input: { command: 'exit 1' },
      response: null,
      session: 's1',
      ts: 100,
    };

    const afterPre = reduceHudState(state, { type: 'event', event: preEvent, now: 1000 });

    const postEvent: HudEvent = {
      schemaVersion: 1,
      event: 'PostToolUse',
      tool: 'Bash',
      toolUseId: 'failing-tool',
      input: null,
      response: { error: 'Command failed' },
      session: 's1',
      ts: 101,
    };

    const result = reduceHudState(afterPre, { type: 'event', event: postEvent, now: 1100 });
    expect(result.tools[0]?.status).toBe('error');
  });

  it('completes running agent on SubagentStop', () => {
    const state = createState();
    const taskEvent: HudEvent = {
      schemaVersion: 1,
      event: 'PreToolUse',
      tool: 'Task',
      toolUseId: 'agent-1',
      input: { subagent_type: 'Plan', description: 'Create plan' },
      response: null,
      session: 's1',
      ts: 100,
    };

    const afterTask = reduceHudState(state, { type: 'event', event: taskEvent, now: 1000 });
    expect(afterTask.agents[0]?.status).toBe('running');

    const stopEvent: HudEvent = {
      schemaVersion: 1,
      event: 'SubagentStop',
      tool: null,
      input: null,
      response: null,
      session: 's1',
      ts: 200,
    };

    const result = reduceHudState(afterTask, { type: 'event', event: stopEvent, now: 2000 });
    expect(result.agents[0]?.status).toBe('complete');
    expect(result.agents[0]?.endTs).toBe(2000);
  });

  it('handles SubagentStop when no running agent exists', () => {
    const state = createState();
    const stopEvent: HudEvent = {
      schemaVersion: 1,
      event: 'SubagentStop',
      tool: null,
      input: null,
      response: null,
      session: 's1',
      ts: 100,
    };

    const result = reduceHudState(state, { type: 'event', event: stopEvent, now: 1000 });
    expect(result.agents).toHaveLength(0);
  });

  it('updates running agent tools from PostToolUse', () => {
    const state = createState();

    const taskEvent: HudEvent = {
      schemaVersion: 1,
      event: 'PreToolUse',
      tool: 'Task',
      toolUseId: 'agent-1',
      input: { subagent_type: 'Research' },
      response: null,
      session: 's1',
      ts: 100,
    };
    let result = reduceHudState(state, { type: 'event', event: taskEvent, now: 1000 });

    const preRead: HudEvent = {
      schemaVersion: 1,
      event: 'PreToolUse',
      tool: 'Read',
      toolUseId: 'read-1',
      input: { file_path: '/test.txt' },
      response: null,
      session: 's1',
      ts: 101,
    };
    result = reduceHudState(result, { type: 'event', event: preRead, now: 1010 });

    const postRead: HudEvent = {
      schemaVersion: 1,
      event: 'PostToolUse',
      tool: 'Read',
      toolUseId: 'read-1',
      input: null,
      response: { duration_ms: 50 },
      session: 's1',
      ts: 102,
    };
    result = reduceHudState(result, { type: 'event', event: postRead, now: 1060 });

    expect(result.agents[0]?.tools).toHaveLength(1);
    expect(result.agents[0]?.tools[0]?.tool).toBe('Read');
  });

  it('handles config action', () => {
    const state = createState();
    const config = { panelOrder: ['tools', 'status'] as const, width: 60 };
    const result = reduceHudState(state, { type: 'config', config });
    expect(result.config).toEqual(config);
  });

  it('handles contextFiles action', () => {
    const state = createState();
    const contextFiles = { totalFiles: 5, fileTypes: { md: 2, ts: 3 } };
    const result = reduceHudState(state, { type: 'contextFiles', contextFiles });
    expect(result.contextFiles).toEqual(contextFiles);
  });

  it('handles settings action', () => {
    const state = createState();
    const settings = {
      model: 'claude-opus-4',
      pluginCount: 3,
      pluginNames: ['a', 'b', 'c'],
      mcpCount: 1,
      mcpNames: ['server'],
      allowedPermissions: ['shell'],
    };
    const result = reduceHudState(state, { type: 'settings', settings });
    expect(result.settings).toEqual(settings);
  });
});
