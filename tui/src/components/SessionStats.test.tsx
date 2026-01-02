import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { SessionStats } from './SessionStats.js';
import type { ToolEntry, ModifiedFile, AgentEntry } from '../lib/types.js';

function createTool(tool: string, id?: string): ToolEntry {
  return {
    id: id || `tool-${Math.random()}`,
    tool,
    target: '/test',
    status: 'complete',
    ts: Date.now(),
    startTs: Date.now() - 100,
  };
}

function createModifiedFile(path: string, additions: number, deletions: number): ModifiedFile {
  return { path, additions, deletions };
}

function createAgent(status: 'running' | 'complete' | 'error' = 'complete'): AgentEntry {
  return {
    id: `agent-${Math.random()}`,
    type: 'explore',
    description: 'Test',
    status,
    startTs: Date.now() - 1000,
    tools: [],
  };
}

describe('SessionStats', () => {
  it('should render session header', () => {
    const { lastFrame } = render(
      <SessionStats tools={[]} modifiedFiles={new Map()} agents={[]} sessionStart={Date.now()} />,
    );
    expect(lastFrame()).toContain('Session');
  });

  it('should show elapsed time in seconds', () => {
    const { lastFrame } = render(
      <SessionStats
        tools={[]}
        modifiedFiles={new Map()}
        agents={[]}
        sessionStart={Date.now() - 30000}
      />,
    );
    expect(lastFrame()).toContain('30s');
  });

  it('should show elapsed time in minutes', () => {
    const { lastFrame } = render(
      <SessionStats
        tools={[]}
        modifiedFiles={new Map()}
        agents={[]}
        sessionStart={Date.now() - 125000}
      />,
    );
    expect(lastFrame()).toContain('2m');
  });

  it('should show elapsed time in hours', () => {
    const { lastFrame } = render(
      <SessionStats
        tools={[]}
        modifiedFiles={new Map()}
        agents={[]}
        sessionStart={Date.now() - 3720000} // 62 minutes
      />,
    );
    expect(lastFrame()).toContain('1h');
    expect(lastFrame()).toContain('2m');
  });

  it('should show top tool counts', () => {
    const tools = [
      createTool('Read'),
      createTool('Read'),
      createTool('Read'),
      createTool('Edit'),
      createTool('Edit'),
      createTool('Grep'),
    ];
    const { lastFrame } = render(
      <SessionStats
        tools={tools}
        modifiedFiles={new Map()}
        agents={[]}
        sessionStart={Date.now()}
      />,
    );
    expect(lastFrame()).toContain('3');
    expect(lastFrame()).toContain('Read');
  });

  it('should show file modification stats', () => {
    const files = new Map<string, ModifiedFile>();
    files.set('/a.ts', createModifiedFile('/a.ts', 10, 5));
    files.set('/b.ts', createModifiedFile('/b.ts', 20, 3));

    const { lastFrame } = render(
      <SessionStats tools={[]} modifiedFiles={files} agents={[]} sessionStart={Date.now()} />,
    );
    expect(lastFrame()).toContain('+30');
    expect(lastFrame()).toContain('-8');
    expect(lastFrame()).toContain('2 files');
  });

  it('should show completed agent count', () => {
    const agents = [createAgent('complete'), createAgent('complete'), createAgent('running')];
    const { lastFrame } = render(
      <SessionStats
        tools={[]}
        modifiedFiles={new Map()}
        agents={agents}
        sessionStart={Date.now()}
      />,
    );
    expect(lastFrame()).toContain('2 agents');
  });

  it('should not show agents section when none completed', () => {
    const agents = [createAgent('running')];
    const { lastFrame } = render(
      <SessionStats
        tools={[]}
        modifiedFiles={new Map()}
        agents={agents}
        sessionStart={Date.now()}
      />,
    );
    expect(lastFrame()).not.toContain('agents');
  });

  it('should limit top tools to 4', () => {
    const tools = [
      ...Array(10)
        .fill(null)
        .map(() => createTool('Read')),
      ...Array(8)
        .fill(null)
        .map(() => createTool('Edit')),
      ...Array(6)
        .fill(null)
        .map(() => createTool('Write')),
      ...Array(4)
        .fill(null)
        .map(() => createTool('Grep')),
      ...Array(2)
        .fill(null)
        .map(() => createTool('Glob')),
    ];
    const { lastFrame } = render(
      <SessionStats
        tools={tools}
        modifiedFiles={new Map()}
        agents={[]}
        sessionStart={Date.now()}
      />,
    );
    const frame = lastFrame() || '';
    expect(frame).toContain('Read');
    expect(frame).toContain('Edit');
    expect(frame).toContain('Write');
    expect(frame).toContain('Grep');
    expect(frame).not.toContain('Glob');
  });
});
