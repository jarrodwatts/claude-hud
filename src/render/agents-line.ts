import type { RenderContext, AgentEntry } from '../types.js';
import { yellow, green, magenta, label } from './colors.js';

export function renderAgentsLine(ctx: RenderContext): string | null {
  const { agents } = ctx.transcript;
  const colors = ctx.config?.colors;
  const agentDetail = ctx.config?.display?.agentDetail ?? 'name';

  const runningAgents = agents.filter((a) => a.status === 'running');
  const recentCompleted = agents
    .filter((a) => a.status === 'completed')
    .slice(-2);

  const toShow = [...runningAgents, ...recentCompleted].slice(-3);

  if (toShow.length === 0) {
    return null;
  }

  const lines: string[] = [];

  for (const agent of toShow) {
    lines.push(formatAgent(agent, colors, agentDetail));
  }

  return lines.join('\n');
}

function formatAgent(agent: AgentEntry, colors?: RenderContext['config']['colors'], agentDetail: 'minimal' | 'name' = 'name'): string {
  const statusIcon = agent.status === 'running' ? yellow('◐') : green('✓');
  const type = agentDetail === 'minimal' ? magenta('Agent') : magenta(agent.type);
  const model = agent.model ? label(`[${agent.model}]`, colors) : '';
  const desc = agentDetail === 'name' && agent.description ? label(`: ${truncateDesc(agent.description)}`, colors) : '';
  const elapsed = formatElapsed(agent);

  return `${statusIcon} ${type}${model ? ` ${model}` : ''}${desc} ${label(`(${elapsed})`, colors)}`;
}

function truncateDesc(desc: string, maxLen: number = 40): string {
  if (desc.length <= maxLen) return desc;
  return desc.slice(0, maxLen - 3) + '...';
}

function formatElapsed(agent: AgentEntry): string {
  const now = Date.now();
  const start = agent.startTime.getTime();
  const end = agent.endTime?.getTime() ?? now;
  const ms = end - start;

  if (ms < 1000) return '<1s';
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;

  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}
