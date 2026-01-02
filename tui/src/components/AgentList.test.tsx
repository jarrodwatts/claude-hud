import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { AgentList } from './AgentList.js';
import type { AgentEntry, ToolEntry } from '../lib/types.js';

function createAgent(overrides: Partial<AgentEntry> = {}): AgentEntry {
  return {
    id: 'agent-1',
    type: 'explore',
    description: 'Finding files',
    status: 'running',
    startTs: Date.now() - 5000,
    tools: [],
    ...overrides,
  };
}

function createTool(overrides: Partial<ToolEntry> = {}): ToolEntry {
  return {
    id: 'tool-1',
    tool: 'Grep',
    target: '/src',
    status: 'complete',
    ts: Date.now(),
    startTs: Date.now() - 100,
    ...overrides,
  };
}

describe('AgentList', () => {
  it('should return null when no agents', () => {
    const { lastFrame } = render(<AgentList agents={[]} />);
    expect(lastFrame()).toBe('');
  });

  it('should render agent header', () => {
    const agents = [createAgent()];
    const { lastFrame } = render(<AgentList agents={agents} />);
    expect(lastFrame()).toContain('Agents');
  });

  it('should show active agent count', () => {
    const agents = [
      createAgent({ id: 'agent-1', status: 'running' }),
      createAgent({ id: 'agent-2', status: 'running' }),
      createAgent({ id: 'agent-3', status: 'complete' }),
    ];
    const { lastFrame } = render(<AgentList agents={agents} />);
    expect(lastFrame()).toContain('(2 active)');
  });

  it('should render agent type', () => {
    const agents = [createAgent({ type: 'codebase-search' })];
    const { lastFrame } = render(<AgentList agents={agents} />);
    expect(lastFrame()).toContain('codebase-search');
  });

  it('should render agent description', () => {
    const agents = [createAgent({ description: 'Searching for auth code' })];
    const { lastFrame } = render(<AgentList agents={agents} />);
    expect(lastFrame()).toContain('Searching for auth code');
  });

  it('should show running status icon', () => {
    const agents = [createAgent({ status: 'running' })];
    const { lastFrame } = render(<AgentList agents={agents} />);
    expect(lastFrame()).toContain('◐');
  });

  it('should show complete status icon', () => {
    const agents = [createAgent({ status: 'complete', endTs: Date.now() })];
    const { lastFrame } = render(<AgentList agents={agents} />);
    expect(lastFrame()).toContain('✓');
  });

  it('should show error status icon', () => {
    const agents = [createAgent({ status: 'error', endTs: Date.now() })];
    const { lastFrame } = render(<AgentList agents={agents} />);
    expect(lastFrame()).toContain('✗');
  });

  it('should limit visible agents to 4', () => {
    const agents = Array.from({ length: 6 }, (_, i) =>
      createAgent({ id: `agent-${i}`, type: `type-${i}` })
    );
    const { lastFrame } = render(<AgentList agents={agents} />);
    const frame = lastFrame() || '';
    expect(frame).toContain('type-2');
    expect(frame).toContain('type-5');
    expect(frame).not.toContain('type-0');
    expect(frame).not.toContain('type-1');
  });

  it('should show agent tools', () => {
    const tools = [createTool({ tool: 'Grep' }), createTool({ id: 'tool-2', tool: 'Read' })];
    const agents = [createAgent({ tools })];
    const { lastFrame } = render(<AgentList agents={agents} />);
    expect(lastFrame()).toContain('Grep');
    expect(lastFrame()).toContain('Read');
  });

  it('should limit visible tools to 3', () => {
    const tools = Array.from({ length: 5 }, (_, i) =>
      createTool({ id: `tool-${i}`, tool: `Tool${i}` })
    );
    const agents = [createAgent({ tools })];
    const { lastFrame } = render(<AgentList agents={agents} />);
    const frame = lastFrame() || '';
    expect(frame).toContain('Tool2');
    expect(frame).toContain('Tool4');
    expect(frame).not.toContain('Tool0');
  });

  it('should truncate long descriptions', () => {
    const agents = [createAgent({ description: 'This is a very long description that exceeds the limit' })];
    const { lastFrame } = render(<AgentList agents={agents} />);
    const frame = lastFrame() || '';
    expect(frame).toContain('…');
  });

  it('should format elapsed time', () => {
    const agents = [createAgent({ startTs: Date.now() - 65000, endTs: Date.now() })];
    const { lastFrame } = render(<AgentList agents={agents} />);
    expect(lastFrame()).toContain('1m');
  });
});
