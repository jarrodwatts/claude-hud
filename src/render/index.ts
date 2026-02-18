import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
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
import { dim, RESET, visualLength } from './colors.js';

export { visualLength } from './colors.js';

// Cached terminal width to avoid expensive detection every ~300ms invocation
let _cachedWidth: number | null = null;
let _cachedWidthAt = 0;
const WIDTH_CACHE_MS = 5_000;

/**
 * Detect terminal width with multiple fallbacks.
 * The plugin runs as a piped subprocess of Claude Code, so process.stdout.columns
 * is typically undefined. We try several methods before falling back to 80.
 */
export function getTerminalWidth(): number {
  const now = Date.now();
  if (_cachedWidth !== null && now - _cachedWidthAt < WIDTH_CACHE_MS) {
    return _cachedWidth;
  }

  let width = detectTerminalWidth();
  _cachedWidth = width;
  _cachedWidthAt = now;
  return width;
}

function detectTerminalWidth(): number {
  // 1. stdout columns (works when stdout is a TTY — rare for plugins)
  if (process.stdout.columns > 0) {
    return process.stdout.columns;
  }

  // 2. stderr columns (may be connected to TTY even when stdout is piped)
  if (process.stderr.columns > 0) {
    return process.stderr.columns;
  }

  // 3. COLUMNS env var (skip 0 and negative — user's env has COLUMNS=0)
  const envCols = parseInt(process.env.COLUMNS || '', 10);
  if (envCols > 0) {
    return envCols;
  }

  // 4. stty size via /dev/tty (works in tmux panes even when stdout is piped)
  try {
    const result = execSync('stty size </dev/tty 2>/dev/null', {
      encoding: 'utf8',
      timeout: 500,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const cols = parseInt(result.trim().split(/\s+/)[1], 10);
    if (cols > 0) return cols;
  } catch {
    // Not available (e.g., no controlling terminal)
  }

  // 5. Conservative default (80, not 120 — better for narrow panes)
  return 80;
}

/** Reset width cache (for testing) */
export function resetWidthCache(): void {
  _cachedWidth = null;
  _cachedWidthAt = 0;
}

/** Width breakpoints for responsive layout */
const EXPANDED_MIN_WIDTH = 80;
const COMPACT_MIN_WIDTH = 40;

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

// Dynamic high-water mark: hold previous line count for HOLD_MS after activity drops,
// then snap down to actual. Prevents ghost lines during transitions without permanent padding.
const HOLD_MS = 3000;

interface LineHighWater {
  highWater: number;
  lastHighAt: number;
}

function getHighWaterPath(): string {
  return path.join(os.homedir(), '.claude', 'plugins', 'claude-hud', '.line-highwater');
}

function readHighWater(): LineHighWater | null {
  try {
    const data = JSON.parse(fs.readFileSync(getHighWaterPath(), 'utf8')) as LineHighWater;
    if (typeof data.highWater !== 'number' || typeof data.lastHighAt !== 'number') return null;
    return data;
  } catch {
    return null;
  }
}

function writeHighWater(data: LineHighWater): void {
  try {
    const p = getHighWaterPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(data), 'utf8');
  } catch {
    // Ignore write failures
  }
}

function getPaddedLineCount(actual: number): number {
  const now = Date.now();
  const prev = readHighWater();

  if (!prev || actual >= prev.highWater) {
    writeHighWater({ highWater: actual, lastHighAt: now });
    return actual;
  }

  // actual < prev.highWater — activity decreased
  if (now - prev.lastHighAt < HOLD_MS) {
    // Hold: keep old line count to prevent ghost lines
    return prev.highWater;
  }

  // Decay: snap down to actual
  writeHighWater({ highWater: actual, lastHighAt: now });
  return actual;
}

export function clearHighWater(): void {
  try {
    fs.unlinkSync(getHighWaterPath());
  } catch {
    // Ignore (file may not exist)
  }
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

function renderCompact(ctx: RenderContext, maxWidth: number): string[] {
  const lines: string[] = [];

  const sessionLine = renderSessionLine(ctx, maxWidth);
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

export function render(ctx: RenderContext): void {
  const preferredLayout = ctx.config?.lineLayout ?? 'expanded';
  const showSeparators = ctx.config?.showSeparators ?? false;

  const termWidth = getTerminalWidth();

  // Responsive layout: auto-switch to compact when terminal is too narrow for expanded
  const effectiveLayout = (preferredLayout === 'expanded' && termWidth < EXPANDED_MIN_WIDTH)
    ? 'compact'
    : preferredLayout;

  const headerLines = effectiveLayout === 'expanded'
    ? renderExpanded(ctx)
    : renderCompact(ctx, termWidth);

  const activityLines = collectActivityLines(ctx);

  const lines: string[] = [...headerLines];

  if (showSeparators && activityLines.length > 0) {
    const sepWidth = Math.max(...headerLines.map(visualLength), 20);
    lines.push(makeSeparator(sepWidth));
  }

  lines.push(...activityLines);

  // Dynamic padding: hold previous line count briefly after activity drops, then snap down
  const renderedCount = lines.reduce((sum, line) => sum + line.split('\n').length, 0);
  const targetLines = getPaddedLineCount(renderedCount);
  for (let i = renderedCount; i < targetLines; i++) {
    lines.push('\u00A0');
  }

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
