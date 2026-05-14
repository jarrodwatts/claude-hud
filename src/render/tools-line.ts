import type { RenderContext } from '../types.js';
import { yellow, green, cyan, label } from './colors.js';

export function renderToolsLine(ctx: RenderContext): string | null {
  const { tools } = ctx.transcript;
  const colors = ctx.config?.colors;
  const configMaxLen = ctx.config?.display?.toolTargetMaxLength;

  if (tools.length === 0) {
    return null;
  }

  const parts: string[] = [];

  const runningTools = tools.filter((t) => t.status === 'running');
  const completedTools = tools.filter((t) => t.status === 'completed' || t.status === 'error');

  for (const tool of runningTools.slice(-2)) {
    const target = tool.target ? truncatePath(tool.target, configMaxLen) : '';
    parts.push(`${yellow('◐')} ${cyan(tool.name)}${target ? label(`: ${target}`, colors) : ''}`);
  }

  const toolCounts = new Map<string, number>();
  for (const tool of completedTools) {
    const count = toolCounts.get(tool.name) ?? 0;
    toolCounts.set(tool.name, count + 1);
  }

  const sortedTools = Array.from(toolCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  for (const [name, count] of sortedTools) {
    parts.push(`${green('✓')} ${name} ${label(`×${count}`, colors)}`);
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.join(' | ');
}

function truncatePath(path: string, configMaxLen?: number): string {
  // 0 means auto (use terminal width), undefined/missing uses default 20
  const maxLen = configMaxLen === 0
    ? Math.max(20, (Number.parseInt(process.env.COLUMNS ?? '', 10) || 120) - 30)
    : (configMaxLen && configMaxLen > 0 ? configMaxLen : 20);

  // Normalize Windows backslashes to forward slashes for consistent display
  const normalizedPath = path.replace(/\\/g, '/');

  if (normalizedPath.length <= maxLen) return normalizedPath;

  // Split by forward slash (already normalized)
  const parts = normalizedPath.split('/');
  const filename = parts.pop() || normalizedPath;

  if (filename.length >= maxLen) {
    return filename.slice(0, maxLen - 3) + '...';
  }

  return '.../' + filename;
}
