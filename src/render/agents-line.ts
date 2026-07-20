import type { RenderContext, AgentEntry } from '../types.js';
import { yellow, green, magenta, label } from './colors.js';
import { truncateString } from '../utils/truncate.js';
import { sanitize as sanitizeDisplayText } from './lines/added-dirs.js';

const MAX_RECENT_COMPLETED = 2;
const MAX_AGENTS_SHOWN = 3;

export function renderAgentsLine(ctx: RenderContext): string | null {
  const { agents } = ctx.transcript;
  const colors = ctx.config?.colors;

  const runningAgents = agents.filter((a) => a.status === 'running');
  const recentCompleted = agents
    .filter((a) => a.status === 'completed')
    .slice(-MAX_RECENT_COMPLETED);

  const seen = new Set<string>();
  const toShow = [...runningAgents, ...recentCompleted]
    .filter((a) => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    })
    .slice(-MAX_AGENTS_SHOWN);

  if (toShow.length === 0) {
    return null;
  }

  const lines: string[] = [];
  for (const agent of toShow) {
    lines.push(formatAgent(agent, colors));
  }
  return lines.join('\n');
}

/**
 * Compacts an agent model into a statusline-sized label.
 *
 * The transcript reports raw model IDs (e.g. "claude-opus-4-8[1m]",
 * "claude-haiku-4-5-20251001"), which are far too long to sit inside an agent
 * line. Family plus version is the part that carries meaning, so the wrapper
 * bits are dropped: the "claude-" prefix, the bracketed context-window variant,
 * and the trailing release date.
 *
 * Anything that does not look like a model ID — notably the short aliases a
 * caller can pass as `model` ("opus", "sonnet", "haiku") — is returned
 * unchanged, so explicit overrides keep rendering the way they always have.
 */
export function formatAgentModel(model: string | undefined): string | undefined {
  if (!model) return undefined;

  const cleaned = sanitizeDisplayText(model).trim();
  if (!cleaned) return undefined;

  const candidate = cleaned.replace(/\[[^\]]*\]$/, '');
  const current = candidate.match(
    /^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d+))?(?:-\d{8})?$/i,
  );
  if (current) {
    const [, family, major, minor] = current;
    return `${family.toLowerCase()}-${major}${minor ? `.${minor}` : ''}`;
  }

  const legacy = candidate.match(
    /^claude-(\d+)(?:-(\d+))?-(opus|sonnet|haiku)(?:-\d{8})?$/i,
  );
  if (legacy) {
    const [, major, minor, family] = legacy;
    return `${family.toLowerCase()}-${major}${minor ? `.${minor}` : ''}`;
  }

  // Provider-qualified and custom model IDs carry routing information. Keep
  // unknown shapes intact rather than guessing which token is the family.
  return /^claude-$/i.test(candidate) ? undefined : cleaned;
}

function getStatusIcon(
  status: AgentEntry['status']
): string {
  switch (status) {
    case 'running':
      return yellow('◐');
    case 'completed':
    default:
      return green('✓');
  }
}

function formatAgent(
  agent: AgentEntry,
  colors?: RenderContext['config']['colors']
): string {
  const statusIcon = getStatusIcon(agent.status);
  const type = magenta(agent.type);
  const modelLabel = formatAgentModel(agent.model);
  const model = modelLabel ? label(`[${modelLabel}]`, colors) : '';
  const desc = agent.description
    ? label(`: ${truncateString(agent.description, 40)}`, colors)
    : '';
  const elapsed = formatElapsed(agent);

  return `${statusIcon} ${type}${model ? ` ${model}` : ''}${desc} ${label(`(${elapsed})`, colors)}`;
}

function formatElapsed(agent: AgentEntry): string {
  const now = Date.now();
  const start = agent.startTime.getTime();
  const end = agent.endTime?.getTime() ?? now;
  const ms = Math.max(0, end - start);

  if (ms < 1000) return '<1s';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;

  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;

  if (mins < 60) return `${mins}m ${secs}s`;

  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return `${hours}h ${remainingMins}m`;
}
