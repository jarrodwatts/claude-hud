import type { RenderContext } from '../types.js';
import { renderSessionLine } from './session-line.js';
import { renderToolsLine } from './tools-line.js';
import { renderAgentsLine } from './agents-line.js';
import { renderTodosLine } from './todos-line.js';
import { dim, RESET } from './colors.js';

// Strip ANSI codes to get visual length
function visualLength(str: string): number {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '').length;
}

function makeSeparator(length: number): string {
  return dim('─'.repeat(Math.max(length, 20)));
}

export function render(ctx: RenderContext): void {
  const layout = ctx.config?.layout ?? 'default';
  const lines: string[] = [];
  const display = ctx.config?.display;

  // Collect activity lines (tools, agents, todos)
  const activityLines: string[] = [];

  if (display?.showTools !== false) {
    const toolsLine = renderToolsLine(ctx);
    if (toolsLine) {
      activityLines.push(toolsLine);
    }
  }

  if (display?.showAgents !== false) {
    const agentsLine = renderAgentsLine(ctx);
    if (agentsLine) {
      activityLines.push(agentsLine);
    }
  }

  if (display?.showTodos !== false) {
    const todosLine = renderTodosLine(ctx);
    if (todosLine) {
      activityLines.push(todosLine);
    }
  }

  // Both layouts use the same session line (model + project + counts + etc)
  const sessionLine = renderSessionLine(ctx);
  if (sessionLine) {
    lines.push(sessionLine);
  }

  // Add separator below header for separators layout (only when activity exists)
  if (layout === 'separators' && activityLines.length > 0) {
    const separatorWidth = visualLength(sessionLine ?? '') + 5;
    lines.push(makeSeparator(separatorWidth));
  }

  lines.push(...activityLines);

  for (const line of lines) {
    const outputLine = `${RESET}${line.replace(/ /g, '\u00A0')}`;
    console.log(outputLine);
  }
}
