import type { RenderContext } from '../types.js';
import { yellow, green, cyan, dim } from './colors.js';

export function renderToolsLine(ctx: RenderContext): string | null {
  const { tools } = ctx.transcript;

  if (tools.length === 0) {
    return null;
  }

  const parts: string[] = [];

  const runningTools = tools.filter((t) => t.status === 'running');
  const completedTools = tools.filter((t) => t.status === 'completed' || t.status === 'error');

  for (const tool of runningTools.slice(-2)) {
    const target = tool.target ? truncatePath(tool.target) : '';
    parts.push(`${yellow('◐')} ${cyan(tool.name)}${target ? dim(`: ${target}`) : ''}`);
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
    parts.push(`${green('✓')} ${name} ${dim(`×${count}`)}`);
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.join(' | ');
}

function truncatePath(path: string, maxLen: number = 20): string {
  // Normalize separators first (convert Windows backslashes to forward slashes)
  const normalized = path.replace(/\\/g, '/');

  if (normalized.length <= maxLen) return normalized;

  // Split by forward slash (already normalized)
  const parts = normalized.split('/');
  const filename = parts.pop() || normalized;

  if (filename.length >= maxLen) {
    return filename.slice(0, maxLen - 3) + '...';
  }

  return '.../' + filename;
}
