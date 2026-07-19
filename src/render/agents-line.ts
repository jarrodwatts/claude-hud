import type { RenderContext, AgentEntry } from '../types.js';
import { yellow, green, magenta, label } from './colors.js';
import { truncateString } from '../utils/truncate.js';

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

  const cleaned = model
    .replace(/\[[^\]]*\]$/, '')
    .trim()
    .toLowerCase()
    .replace(/^claude-/, '');
  if (!cleaned) return undefined;

  const tokens = cleaned.split('-').filter(Boolean);
  if (tokens.length === 0) return undefined;

  // Trailing release date (e.g. "-20251001") carries nothing for a reader.
  if (/^\d{8}$/.test(tokens[tokens.length - 1])) {
    tokens.pop();
  }

  const familyIndex = tokens.findIndex((token) => !/^\d+$/.test(token));
  if (familyIndex === -1) return tokens.join('-');

  const family = tokens[familyIndex];
  // Version sits after the family in current IDs ("sonnet-4-6") and before it in
  // older ones ("3-7-sonnet"), so read whichever side carries it.
  const after = readVersionTokens(tokens, familyIndex + 1, 1);
  const version = after.length > 0
    ? after
    : readVersionTokens(tokens, familyIndex - 1, -1).reverse();

  return version.length > 0 ? `${family}-${version.join('.')}` : family;
}

// Two components is what a Claude version carries ("4-8" -> 4.8); stopping
// there also keeps the label bounded, matching normalizeBedrockModelLabel.
const MAX_VERSION_PARTS = 2;

function readVersionTokens(tokens: string[], startIndex: number, step: -1 | 1): string[] {
  const parts: string[] = [];
  for (let i = startIndex; i >= 0 && i < tokens.length; i += step) {
    if (!/^\d+$/.test(tokens[i])) break;
    parts.push(tokens[i]);
    if (parts.length === MAX_VERSION_PARTS) break;
  }
  return parts;
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
