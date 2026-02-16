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

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, '');
}

function visualLength(str: string): number {
  return stripAnsi(str).length;
}

function getTerminalWidth(): number {
  return process.stdout.columns
    || process.stderr.columns
    || parseInt(process.env.COLUMNS || '', 10)
    || 120;
}

// Truncate an ANSI-escaped string to fit within maxWidth visual columns
function truncateToWidth(str: string, maxWidth: number): string {
  if (visualLength(str) <= maxWidth) return str;

  let visual = 0;
  let i = 0;

  while (i < str.length) {
    // Skip ANSI escape sequences (zero visual width)
    if (str[i] === '\x1b' && str[i + 1] === '[') {
      const end = str.indexOf('m', i);
      if (end !== -1) {
        i = end + 1;
        continue;
      }
    }
    if (visual >= maxWidth) break;
    visual++;
    i++;
  }

  return str.slice(0, i) + RESET;
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

// Calculate max lines for this config to pad output consistently
function getMaxLines(ctx: RenderContext): number {
  const lineLayout = ctx.config?.lineLayout ?? 'expanded';
  const display = ctx.config?.display;
  const showSeparators = ctx.config?.showSeparators ?? false;

  let max = lineLayout === 'expanded' ? 2 : 1;

  if (lineLayout === 'expanded' && display?.showConfigCounts) {
    max += 1;
  }

  const hasActivityConfig = display?.showTools !== false
    || display?.showAgents !== false
    || display?.showTodos !== false;
  if (showSeparators && hasActivityConfig) {
    max += 1;
  }

  if (display?.showTools !== false) {
    max += 1;
  }

  if (display?.showAgents !== false) {
    max += 3; // up to 3 agents
  }

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

  // Pad to fixed line count to prevent ghost lines when activity disappears
  const maxLines = getMaxLines(ctx);
  const renderedCount = lines.reduce((sum, line) => sum + line.split('\n').length, 0);
  for (let i = renderedCount; i < maxLines; i++) {
    lines.push('\u00A0');
  }

  const termWidth = getTerminalWidth();

  for (const line of lines) {
    // Handle embedded newlines (e.g. multi-agent output)
    const subLines = line.split('\n');
    for (const sub of subLines) {
      const truncated = truncateToWidth(sub, termWidth);
      const outputLine = `${RESET}${truncated.replace(/ /g, '\u00A0')}`;
      console.log(outputLine);
    }
  }
}
