import type { RenderContext } from '../types.js';
import { yellow, green, cyan, label } from './colors.js';

const ELLIPSIS = '…';
const MCP_TOOL_NAME_PATTERN = /^mcp__.+__.+$/;

export function shortenToolName(name: string, maxLen: number): string {
  if (maxLen === 0) {
    return name;
  }

  const displayName = MCP_TOOL_NAME_PATTERN.test(name)
    ? (name.split('__').pop() ?? name)
    : name;

  if (displayName.length <= maxLen) {
    return displayName;
  }

  return `${displayName.slice(0, Math.max(0, maxLen - 1))}${ELLIPSIS}`;
}

export function renderToolsLine(ctx: RenderContext): string | null {
  const hideSkillTools = ctx.config?.display?.showSkills === true;
  const tools = hideSkillTools
    ? ctx.transcript.tools.filter((tool) => tool.name !== 'Skill')
    : ctx.transcript.tools;
  const colors = ctx.config?.colors;
  const toolNameMaxLength = ctx.config?.display?.toolNameMaxLength ?? 0;
  const toolsMaxVisible = ctx.config?.display?.toolsMaxVisible ?? 4;

  if (tools.length === 0) {
    return null;
  }

  const parts: string[] = [];

  const runningTools = tools.filter((t) => t.status === 'running');
  const completedTools = tools.filter((t) => t.status === 'completed' || t.status === 'error');

  for (const tool of runningTools.slice(-2)) {
    const target = tool.target ? truncatePath(tool.target) : '';
    const name = shortenToolName(tool.name, toolNameMaxLength);
    parts.push(`${yellow('◐')} ${cyan(name)}${target ? label(`: ${target}`, colors) : ''}`);
  }

  const toolCounts = new Map<string, number>();
  for (const tool of completedTools) {
    // Aggregate all Skills under single "Skill" key
    const key = tool.name === 'Skill' ? 'Skill' : tool.name;
    const count = toolCounts.get(key) ?? 0;
    toolCounts.set(key, count + 1);
  }

  const sortedTools = Array.from(toolCounts.entries())
    .sort((a, b) => b[1] - a[1]);
  const visibleTools = toolsMaxVisible === 0
    ? sortedTools
    : sortedTools.slice(0, toolsMaxVisible);

  for (const [name, count] of visibleTools) {
    parts.push(`${green('✓')} ${shortenToolName(name, toolNameMaxLength)} ${label(`×${count}`, colors)}`);
  }

  const hiddenToolCount = toolsMaxVisible === 0 ? 0 : sortedTools.length - visibleTools.length;
  if (hiddenToolCount > 0) {
    parts.push(label(`+${hiddenToolCount} more`, colors));
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.join(' | ');
}

function truncatePath(path: string, maxLen: number = 20): string {
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
