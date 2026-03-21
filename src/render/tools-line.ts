import type { RenderContext } from '../types.js';
import { yellow, green, cyan, dim, magenta, red } from './colors.js';
import { truncatePath } from '../utils/format.js';
import { getLabels } from '../i18n.js';

export function renderToolsLine(ctx: RenderContext): string | null {
  const labels = getLabels(ctx.locale || 'en');
  const { tools } = ctx.transcript;

  if (tools.length === 0) {
    return null;
  }

  const parts: string[] = [];

  const runningTools = tools.filter((t) => t.status === 'running');
  const completedTools = tools.filter((t) => t.status === 'completed' || t.status === 'error');

  for (const tool of runningTools.slice(-2)) {
    const target = tool.target ? truncatePath(tool.target.replace(/\\/g, '/')) : '';
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

  // Show error count if any tools failed
  const errorCount = ctx.transcript.tools.filter(t => t.status === 'error').length;
  if (errorCount > 0) {
    parts.push(`${red('✘')} ${errorCount} ${labels.err}`);
  }

  if (ctx.config.display.mergeToolsAgents && ctx.transcript.agents.length > 0) {
    const recentAgents = ctx.transcript.agents.slice(-2);
    for (const agent of recentAgents) {
      const icon = agent.status === 'running' ? magenta('◐') : green('✓');
      const model = agent.model ? dim(`[${agent.model}]`) : '';
      const desc = agent.description ? dim(`: ${agent.description.slice(0, 30)}`) : '';
      parts.push(`${icon} ${agent.type || 'agent'}${model}${desc}`);
    }
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.join(' | ');
}

