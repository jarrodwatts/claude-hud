import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { McpStatus } from './McpStatus.js';

describe('McpStatus', () => {
  it('should return null when no servers or plugins', () => {
    const { lastFrame } = render(<McpStatus servers={[]} />);
    expect(lastFrame()).toBe('');
  });

  it('should return null when empty arrays', () => {
    const { lastFrame } = render(<McpStatus servers={[]} plugins={[]} />);
    expect(lastFrame()).toBe('');
  });

  it('should render header when servers exist', () => {
    const { lastFrame } = render(<McpStatus servers={['context7']} />);
    expect(lastFrame()).toContain('Connections');
  });

  it('should render MCP servers', () => {
    const { lastFrame } = render(<McpStatus servers={['context7', 'exa']} />);
    expect(lastFrame()).toContain('MCP:');
    expect(lastFrame()).toContain('context7');
    expect(lastFrame()).toContain('exa');
  });

  it('should join multiple servers with bullet', () => {
    const { lastFrame } = render(<McpStatus servers={['a', 'b', 'c']} />);
    expect(lastFrame()).toContain('•');
  });

  it('should limit displayed servers to 3', () => {
    const servers = ['server1', 'server2', 'server3', 'server4', 'server5'];
    const { lastFrame } = render(<McpStatus servers={servers} />);
    const frame = lastFrame() || '';
    expect(frame).toContain('server1');
    expect(frame).toContain('server2');
    expect(frame).toContain('server3');
    expect(frame).not.toContain('server4');
    expect(frame).not.toContain('server5');
  });

  it('should show server overflow count', () => {
    const servers = ['server1', 'server2', 'server3', 'server4', 'server5'];
    const { lastFrame } = render(<McpStatus servers={servers} />);
    expect(lastFrame()).toContain('+2');
  });

  it('should render plugins', () => {
    const { lastFrame } = render(<McpStatus servers={[]} plugins={['plugin1', 'plugin2']} />);
    expect(lastFrame()).toContain('Plugins:');
    expect(lastFrame()).toContain('plugin1');
    expect(lastFrame()).toContain('plugin2');
  });

  it('should limit displayed plugins to 3', () => {
    const plugins = ['plug1', 'plug2', 'plug3', 'plug4'];
    const { lastFrame } = render(<McpStatus servers={[]} plugins={plugins} />);
    const frame = lastFrame() || '';
    expect(frame).toContain('plug1');
    expect(frame).toContain('plug2');
    expect(frame).toContain('plug3');
    expect(frame).not.toContain('plug4');
  });

  it('should show plugin overflow count', () => {
    const plugins = ['plug1', 'plug2', 'plug3', 'plug4', 'plug5'];
    const { lastFrame } = render(<McpStatus servers={[]} plugins={plugins} />);
    expect(lastFrame()).toContain('+2');
  });

  it('should render both servers and plugins', () => {
    const { lastFrame } = render(
      <McpStatus servers={['mcp1']} plugins={['plugin1']} />
    );
    expect(lastFrame()).toContain('MCP:');
    expect(lastFrame()).toContain('mcp1');
    expect(lastFrame()).toContain('Plugins:');
    expect(lastFrame()).toContain('plugin1');
  });

  it('should not show MCP section when only plugins', () => {
    const { lastFrame } = render(<McpStatus servers={[]} plugins={['plugin1']} />);
    expect(lastFrame()).not.toContain('MCP:');
    expect(lastFrame()).toContain('Plugins:');
  });

  it('should not show Plugins section when only servers', () => {
    const { lastFrame } = render(<McpStatus servers={['server1']} plugins={[]} />);
    expect(lastFrame()).toContain('MCP:');
    expect(lastFrame()).not.toContain('Plugins:');
  });
});
