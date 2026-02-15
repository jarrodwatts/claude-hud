import type { RenderContext } from '../types.js';
import { renderSessionLine } from './session-line.js';
import { renderToolsLine } from './tools-line.js';
import { renderAgentsLine } from './agents-line.js';
import { renderTodosLine } from './todos-line.js';
import {
  renderIdentityLine,
  renderProjectLine,
  renderEnvironmentLine,
  renderUsageLine,
} from './lines/index.js';
import { dim, RESET } from './colors.js';

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function visualLength(str: string): number {
  return stripAnsi(str).length;
}

function makeSeparator(length: number): string {
  return dim('─'.repeat(Math.max(length, 20)));
}

function collectActivityLines(ctx: RenderContext): string[] {
  const activityLines: string[] = [];
  const display = ctx.config?.display;

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

  return activityLines;
}

function renderCompact(ctx: RenderContext): string[] {
  const lines: string[] = [];

  const sessionLine = renderSessionLine(ctx);
  if (sessionLine) {
    lines.push(sessionLine);
  }

  return lines;
}

function renderExpanded(ctx: RenderContext): string[] {
  const lines: string[] = [];

  const projectLine = renderProjectLine(ctx);
  if (projectLine) {
    lines.push(projectLine);
  }

  const identityLine = renderIdentityLine(ctx);
  const usageLine = renderUsageLine(ctx);
  if (identityLine && usageLine) {
    lines.push(`${identityLine} \u2502 ${usageLine}`);
  } else if (identityLine) {
    lines.push(identityLine);
  }

  const environmentLine = renderEnvironmentLine(ctx);
  if (environmentLine) {
    lines.push(environmentLine);
  }

  return lines;
}

/**
 * Calculate the maximum number of lines the HUD could output for this config.
 * Used to pad output so Claude Code always sees a consistent line count,
 * preventing ghost lines when activity lines appear/disappear.
 */
function getMaxLines(ctx: RenderContext): number {
  const lineLayout = ctx.config?.lineLayout ?? 'expanded';
  const display = ctx.config?.display;
  const showSeparators = ctx.config?.showSeparators ?? false;

  // Header lines: expanded = 2 (project + identity), compact = 1
  let max = lineLayout === 'expanded' ? 2 : 1;

  // Environment line (expanded only, opt-in)
  if (lineLayout === 'expanded' && display?.showConfigCounts) {
    max += 1;
  }

  // Separator (only when activity is possible)
  const hasActivityConfig = display?.showTools !== false
    || display?.showAgents !== false
    || display?.showTodos !== false;
  if (showSeparators && hasActivityConfig) {
    max += 1;
  }

  // Tools line: 1 line max
  if (display?.showTools !== false) {
    max += 1;
  }

  // Agents line: up to 3 agents, each on its own line
  if (display?.showAgents !== false) {
    max += 3;
  }

  // Todos line: 1 line max
  if (display?.showTodos !== false) {
    max += 1;
  }

  return max;
}

export function render(ctx: RenderContext): void {
  const lineLayout = ctx.config?.lineLayout ?? 'expanded';
  const showSeparators = ctx.config?.showSeparators ?? false;

  const headerLines = lineLayout === 'expanded'
    ? renderExpanded(ctx)
    : renderCompact(ctx);

  const activityLines = collectActivityLines(ctx);

  const lines: string[] = [...headerLines];

  if (showSeparators && activityLines.length > 0) {
    const maxWidth = Math.max(...headerLines.map(visualLength), 20);
    lines.push(makeSeparator(maxWidth));
  }

  lines.push(...activityLines);

  // Pad to a fixed line count so Claude Code always sees the same number
  // of lines, preventing ghost/stale lines when activity disappears.
  // Count actual rendered lines (some entries contain embedded \n).
  const maxLines = getMaxLines(ctx);
  const renderedCount = lines.reduce(
    (sum, line) => sum + line.split('\n').length, 0
  );
  for (let i = renderedCount; i < maxLines; i++) {
    lines.push('\u00A0'); // non-breaking space — not empty, so Claude Code renders it
  }

  for (const line of lines) {
    const outputLine = `${RESET}${line.replace(/ /g, '\u00A0')}`;
    console.log(outputLine);
  }
}
