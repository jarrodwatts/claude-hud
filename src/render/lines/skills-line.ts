import type { RenderContext } from '../../types.js';
import { yellow, cyan, label } from '../colors.js';

const MAX_SKILLS_SHOWN = 4;

export function renderSkillsLine(ctx: RenderContext): string | null {
  const { skillNames } = ctx;
  const colors = ctx.config?.colors;

  if (!skillNames || skillNames.length === 0) {
    return null;
  }

  const shown = skillNames.slice(0, MAX_SKILLS_SHOWN);
  const parts: string[] = [];

  for (const name of shown) {
    parts.push(`${yellow('◐')} ${cyan(name)}`);
  }

  const remaining = skillNames.length - shown.length;
  if (remaining > 0) {
    parts.push(label(`+${remaining} more`, colors));
  }

  return parts.join(' | ');
}
