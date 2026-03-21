import type { RenderContext } from '../types.js';
import { yellow, green, dim, claudeOrange } from './colors.js';
import { truncateString } from '../utils/format.js';

export function renderTodosLine(ctx: RenderContext): string | null {
  const { todos } = ctx.transcript;

  if (!todos || todos.length === 0) {
    return null;
  }

  const inProgress = todos.find((t) => t.status === 'in_progress');
  const completed = todos.filter((t) => t.status === 'completed').length;
  const total = todos.length;

  if (!inProgress) {
    if (completed === total && total > 0) {
      return `${green('✓')} All todos complete ${dim(`(${completed}/${total})`)}`;
    }
    return null;
  }

  const content = truncateString(inProgress.content, 50);
  const progress = dim(`(${completed}/${total})`);

  const miniBar = ctx.transcript.todos.slice(0, 10).map(todo => {
    if (todo.status === 'completed') return green('▪');
    if (todo.status === 'in_progress') return claudeOrange('▪');
    return dim('▪');
  }).join('');
  const suffix = ctx.transcript.todos.length > 10 ? dim('…') : '';

  return `${yellow('▸')} ${content} ${progress} │ ${miniBar}${suffix}`;
}

