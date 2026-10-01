import type { HudColorOverrides } from '../config.js';
import type { RenderContext } from '../types.js';
import { cyan, green, label } from './colors.js';
import { sanitizeDisplayText } from '../utils/sanitize.js';

const MAX_ITEMS_SHOWN = 4;
const ACTIVITY_NAME_MAX_LEN = 64;

export function renderSkillsLine(ctx: RenderContext): string | null {
  if (ctx.config?.display?.showSkills !== true) {
    return null;
  }

  return renderNameListLine(
    'Skills',
    ctx.transcript.skills ?? [],
    ctx.config?.colors,
    ctx.config?.display?.skillsMaxVisible ?? MAX_ITEMS_SHOWN,
  );
}

export function renderMcpLine(ctx: RenderContext): string | null {
  if (ctx.config?.display?.showMcp !== true) {
    return null;
  }

  return renderNameListLine('MCPs', ctx.transcript.mcpServers ?? [], ctx.config?.colors);
}

function renderNameListLine(
  title: string,
  names: string[],
  colors?: Partial<HudColorOverrides>,
  maxVisible: number = MAX_ITEMS_SHOWN,
): string | null {
  const safeNames = names.map(safeActivityName).filter((name): name is string => Boolean(name));
  if (safeNames.length === 0) {
    return null;
  }

  const shown = maxVisible === 0 ? safeNames : safeNames.slice(0, maxVisible);
  const visibleNames = shown.map(name => cyan(name));
  const hiddenCount = safeNames.length - visibleNames.length;
  if (hiddenCount > 0) {
    visibleNames.push(label(`+${hiddenCount} more`, colors));
  }

  return `${green('✓')} ${title} ${label(`(${safeNames.length})`, colors)}: ${visibleNames.join(', ')}`;
}

function safeActivityName(value: string): string | null {
  const sanitized = sanitizeDisplayText(value).trim();

  if (!sanitized) {
    return null;
  }

  if (sanitized.length <= ACTIVITY_NAME_MAX_LEN) {
    return sanitized;
  }

  return `${sanitized.slice(0, ACTIVITY_NAME_MAX_LEN - 1)}…`;
}
