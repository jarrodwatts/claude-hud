import type { AgentEntry } from '../types.js';
import { t } from '../i18n/index.js';
import { sanitizeDisplayText } from '../utils/sanitize.js';
import { truncateString } from '../utils/truncate.js';
import type { Frame } from './frame.js';
import { cyan, green, label, magenta, yellow } from './colors.js';

export type ActivityElement = 'tools' | 'skills' | 'mcp' | 'agents' | 'todos';

function shortenToolName(rawName: string, maxLength: number): string {
  const name = sanitizeDisplayText(rawName);
  if (maxLength === 0) return name;
  const shown = /^mcp__.+__.+$/.test(name) ? name.split('__').pop() ?? name : name;
  return shown.length <= maxLength ? shown : `${shown.slice(0, Math.max(0, maxLength - 1))}…`;
}

function shortenPath(target: string, maxLength = 20): string {
  const normalized = sanitizeDisplayText(target).replace(/\\/g, '/');
  if (normalized.length <= maxLength) return normalized;
  const filename = normalized.split('/').pop() || normalized;
  return filename.length >= maxLength ? `${filename.slice(0, maxLength - 3)}...` : `.../${filename}`;
}

/** `◐ Edit: auth.ts | ✓ Read ×3 | +2 more`: the two newest running tools, then completed counts. */
function toolsLine(f: Frame): string | null {
  const display = f.config?.display;
  const colors = f.config?.colors;
  // With a skills line, Skill invocations live there instead.
  const tools = display?.showSkills === true ? f.transcript.tools.filter((tool) => tool.name !== 'Skill') : f.transcript.tools;
  const maxLength = display?.toolNameMaxLength ?? 0;
  const maxVisible = display?.toolsMaxVisible ?? 4;

  const parts = tools
    .filter((tool) => tool.status === 'running')
    .slice(-2)
    .map((tool) => {
      const target = tool.target ? label(`: ${shortenPath(tool.target)}`, colors) : '';
      return `${yellow('◐')} ${cyan(shortenToolName(tool.name, maxLength))}${target}`;
    });

  const counts = new Map<string, number>();
  for (const tool of tools) {
    if (tool.status !== 'running') counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
  }
  const sorted = [...counts].sort((a, b) => b[1] - a[1]);
  const visible = maxVisible === 0 ? sorted : sorted.slice(0, maxVisible);
  for (const [name, count] of visible) {
    parts.push(`${green('✓')} ${shortenToolName(name, maxLength)} ${label(`×${count}`, colors)}`);
  }
  if (sorted.length > visible.length) parts.push(label(`+${sorted.length - visible.length} more`, colors));
  return parts.length > 0 ? parts.join(' | ') : null;
}

const ACTIVITY_NAME_MAX = 64;

/** `✓ Skills (5): a, b, c, d, +1 more`. */
function namesLine(f: Frame, title: string, names: string[], maxVisible: number): string | null {
  const colors = f.config?.colors;
  const safe = names
    .map((name) => sanitizeDisplayText(name).trim())
    .filter(Boolean)
    .map((name) => (name.length <= ACTIVITY_NAME_MAX ? name : `${name.slice(0, ACTIVITY_NAME_MAX - 1)}…`));
  if (safe.length === 0) return null;
  const shown = (maxVisible === 0 ? safe : safe.slice(0, maxVisible)).map((name) => cyan(name));
  if (safe.length > shown.length) shown.push(label(`+${safe.length - shown.length} more`, colors));
  return `${green('✓')} ${title} ${label(`(${safe.length})`, colors)}: ${shown.join(', ')}`;
}

const MAX_AGENTS = 3;
const MAX_RECENT_COMPLETED = 2;
const COMPLETED_RETENTION_MS = 60_000;

/** `claude-haiku-4-5-20251001` → `haiku-4.5`; aliases and unknown IDs pass through. */
function shortModel(model: string | undefined): string | undefined {
  const cleaned = model ? sanitizeDisplayText(model).trim() : '';
  if (!cleaned) return undefined;
  const id = cleaned.replace(/\[[^\]]*\]$/, '');
  const current = id.match(/^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d+))?(?:-\d{8})?$/i);
  if (current) return `${current[1].toLowerCase()}-${current[2]}${current[3] ? `.${current[3]}` : ''}`;
  const legacy = id.match(/^claude-(\d+)(?:-(\d+))?-(opus|sonnet|haiku)(?:-\d{8})?$/i);
  if (legacy) return `${legacy[3].toLowerCase()}-${legacy[1]}${legacy[2] ? `.${legacy[2]}` : ''}`;
  return /^claude-$/i.test(id) ? undefined : cleaned;
}

function formatElapsed(agent: AgentEntry, now: number): string {
  const ms = Math.max(0, (agent.endTime?.getTime() ?? now) - agent.startTime.getTime());
  if (ms < 1000) return '<1s';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const totalSeconds = Math.floor(ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  if (mins < 60) return `${mins}m ${totalSeconds % 60}s`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/** Up to three agents: running ones first, then those that finished in the last minute. */
function agentsLine(f: Frame): string | null {
  const colors = f.config?.colors;
  const seen = new Set<string>();
  const firstSighting = (agent: AgentEntry): boolean => !seen.has(agent.id) && !!seen.add(agent.id);
  const running = f.transcript.agents.filter((agent) => agent.status === 'running').filter(firstSighting).slice(-MAX_AGENTS);
  const slots = Math.min(MAX_RECENT_COMPLETED, MAX_AGENTS - running.length);
  const recent = f.transcript.agents
    .filter((agent) => {
      const endedAt = agent.endTime?.getTime();
      return agent.status === 'completed' && endedAt !== undefined && Number.isFinite(endedAt)
        && endedAt <= f.now && f.now - endedAt <= COMPLETED_RETENTION_MS;
    })
    .filter(firstSighting);
  const shown = [...running, ...(slots > 0 ? recent.slice(-slots) : [])];
  if (shown.length === 0) return null;

  const clean = (value: unknown, max: number): string => (typeof value === 'string' ? truncateString(sanitizeDisplayText(value).trim(), max) : '');
  return shown.map((agent) => {
    const icon = agent.status === 'running' ? yellow('◐') : green('✓');
    const model = shortModel(agent.model);
    const description = clean(agent.description, 40);
    return `${icon} ${magenta(clean(agent.type, 24) || 'agent')}${model ? ` ${label(`[${model}]`, colors)}` : ''}`
      + `${description ? label(`: ${description}`, colors) : ''} ${label(`(${formatElapsed(agent, f.now)})`, colors)}`;
  }).join('\n');
}

/** `▸ Fix the bug (2/5)`, or `✓ All todos complete (5/5)`. */
function todosLine(f: Frame): string | null {
  const todos = f.transcript.todos;
  if (!todos || todos.length === 0) return null;
  const colors = f.config?.colors;
  const completed = todos.filter((todo) => todo.status === 'completed').length;
  const progress = label(`(${completed}/${todos.length})`, colors);
  const current = todos.find((todo) => todo.status === 'in_progress');
  if (current) return `${yellow('▸')} ${truncateString(sanitizeDisplayText(current.content), 50)} ${progress}`;
  return completed === todos.length ? `${green('✓')} ${t('status.allTodosComplete')} ${progress}` : null;
}

export function activityLine(f: Frame, element: ActivityElement): string | null {
  const display = f.config?.display;
  switch (element) {
    case 'tools':
      return display?.showTools === false ? null : toolsLine(f);
    case 'skills':
      return display?.showSkills === true ? namesLine(f, 'Skills', f.transcript.skills ?? [], display.skillsMaxVisible ?? 4) : null;
    case 'mcp':
      return display?.showMcp === true ? namesLine(f, 'MCPs', f.transcript.mcpServers ?? [], 4) : null;
    case 'agents':
      return display?.showAgents === false ? null : agentsLine(f);
    case 'todos':
      return display?.showTodos === false ? null : todosLine(f);
  }
}
