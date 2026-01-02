import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { TodoList } from './TodoList.js';
import type { TodoItem } from '../lib/types.js';

describe('TodoList', () => {
  it('should render empty state when no todos', () => {
    const { lastFrame } = render(<TodoList todos={[]} />);
    expect(lastFrame()).toContain('No todos');
  });

  it('should render todo header', () => {
    const { lastFrame } = render(<TodoList todos={[]} />);
    expect(lastFrame()).toContain('Todo');
  });

  it('should render pending todo with checkbox', () => {
    const todos: TodoItem[] = [{ content: 'Write tests', status: 'pending' }];
    const { lastFrame } = render(<TodoList todos={todos} />);
    expect(lastFrame()).toContain('[ ]');
    expect(lastFrame()).toContain('Write tests');
  });

  it('should render in_progress todo with filled circle', () => {
    const todos: TodoItem[] = [{ content: 'Writing tests', status: 'in_progress' }];
    const { lastFrame } = render(<TodoList todos={todos} />);
    expect(lastFrame()).toContain('[●]');
    expect(lastFrame()).toContain('Writing tests');
  });

  it('should render completed todo with checkmark', () => {
    const todos: TodoItem[] = [{ content: 'Tests written', status: 'completed' }];
    const { lastFrame } = render(<TodoList todos={todos} />);
    expect(lastFrame()).toContain('[✓]');
    expect(lastFrame()).toContain('Tests written');
  });

  it('should render multiple todos', () => {
    const todos: TodoItem[] = [
      { content: 'First task', status: 'completed' },
      { content: 'Second task', status: 'in_progress' },
      { content: 'Third task', status: 'pending' },
    ];
    const { lastFrame } = render(<TodoList todos={todos} />);
    expect(lastFrame()).toContain('First task');
    expect(lastFrame()).toContain('Second task');
    expect(lastFrame()).toContain('Third task');
  });

  it('should limit visible todos to 6', () => {
    const todos: TodoItem[] = Array.from({ length: 10 }, (_, i) => ({
      content: `Task ${i + 1}`,
      status: 'pending',
    }));
    const { lastFrame } = render(<TodoList todos={todos} />);
    expect(lastFrame()).toContain('Task 1');
    expect(lastFrame()).toContain('Task 6');
    expect(lastFrame()).not.toContain('Task 7');
  });

  it('should show overflow count when more than 6 todos', () => {
    const todos: TodoItem[] = Array.from({ length: 10 }, (_, i) => ({
      content: `Task ${i + 1}`,
      status: 'pending',
    }));
    const { lastFrame } = render(<TodoList todos={todos} />);
    expect(lastFrame()).toContain('+4 more');
  });

  it('should not show overflow for exactly 6 todos', () => {
    const todos: TodoItem[] = Array.from({ length: 6 }, (_, i) => ({
      content: `Task ${i + 1}`,
      status: 'pending',
    }));
    const { lastFrame } = render(<TodoList todos={todos} />);
    expect(lastFrame()).not.toContain('more');
  });

  it('should truncate long todo content', () => {
    const todos: TodoItem[] = [
      { content: 'This is a very long todo item that should be truncated', status: 'pending' },
    ];
    const { lastFrame } = render(<TodoList todos={todos} />);
    const frame = lastFrame() || '';
    expect(frame.length).toBeLessThan(100);
  });
});
