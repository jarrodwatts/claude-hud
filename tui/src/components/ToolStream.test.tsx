import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { ToolStream } from './ToolStream.js';
import type { ToolEntry } from '../lib/types.js';

function createTool(overrides: Partial<ToolEntry> = {}): ToolEntry {
  return {
    id: 'tool-1',
    tool: 'Read',
    target: '/path/to/file.ts',
    status: 'complete',
    ts: Date.now(),
    startTs: Date.now() - 100,
    endTs: Date.now(),
    duration: 100,
    ...overrides,
  };
}

describe('ToolStream', () => {
  describe('rendering', () => {
    it('should render empty state when no tools', () => {
      const { lastFrame } = render(<ToolStream tools={[]} />);
      expect(lastFrame()).toContain('No tool activity yet');
    });

    it('should render tool name', () => {
      const tools = [createTool({ tool: 'Read' })];
      const { lastFrame } = render(<ToolStream tools={tools} />);
      expect(lastFrame()).toContain('Read');
    });

    it('should render tools header with count', () => {
      const tools = [createTool(), createTool({ id: 'tool-2' })];
      const { lastFrame } = render(<ToolStream tools={tools} />);
      expect(lastFrame()).toContain('Tools');
      expect(lastFrame()).toContain('(2)');
    });

    it('should show running status icon', () => {
      const tools = [createTool({ status: 'running' })];
      const { lastFrame } = render(<ToolStream tools={tools} />);
      expect(lastFrame()).toContain('◐');
    });

    it('should show complete status icon', () => {
      const tools = [createTool({ status: 'complete' })];
      const { lastFrame } = render(<ToolStream tools={tools} />);
      expect(lastFrame()).toContain('✓');
    });

    it('should show error status icon', () => {
      const tools = [createTool({ status: 'error' })];
      const { lastFrame } = render(<ToolStream tools={tools} />);
      expect(lastFrame()).toContain('✗');
    });

    it('should limit visible tools to maxVisible', () => {
      const tools = Array.from({ length: 15 }, (_, i) =>
        createTool({ id: `tool-${i}`, tool: `Tool${i}` })
      );
      const { lastFrame } = render(<ToolStream tools={tools} maxVisible={5} />);
      const frame = lastFrame() || '';
      expect(frame).toContain('Tool10');
      expect(frame).toContain('Tool14');
      expect(frame).not.toContain('Tool0');
    });

    it('should format duration in milliseconds', () => {
      const tools = [createTool({ duration: 500 })];
      const { lastFrame } = render(<ToolStream tools={tools} />);
      expect(lastFrame()).toContain('500ms');
    });

    it('should format duration in seconds', () => {
      const tools = [createTool({ duration: 2500 })];
      const { lastFrame } = render(<ToolStream tools={tools} />);
      expect(lastFrame()).toContain('2.5s');
    });

    it('should format long duration as rounded seconds', () => {
      const tools = [createTool({ duration: 15000 })];
      const { lastFrame } = render(<ToolStream tools={tools} />);
      expect(lastFrame()).toContain('15s');
    });

    it('should truncate long file paths', () => {
      const longPath = '/very/long/deeply/nested/path/that/exceeds/the/maximum/allowed/limit/file.ts';
      const tools = [createTool({ target: longPath })];
      const { lastFrame } = render(<ToolStream tools={tools} />);
      const frame = lastFrame() || '';
      expect(frame).toContain('file.ts');
      expect(frame.length).toBeLessThan(longPath.length + 50);
    });

    it('should show short paths without truncation', () => {
      const tools = [createTool({ target: 'src/file.ts' })];
      const { lastFrame } = render(<ToolStream tools={tools} />);
      expect(lastFrame()).toContain('src/file.ts');
    });

    it('should handle empty target', () => {
      const tools = [createTool({ target: '' })];
      const { lastFrame } = render(<ToolStream tools={tools} />);
      expect(lastFrame()).toContain('Read');
    });
  });
});
