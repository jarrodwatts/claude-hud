import type { RenderContext } from '../../types.js';
import { yellow, cyan, label } from '../colors.js';

const MAX_MCP_SHOWN = 4;

export function renderMcpLine(ctx: RenderContext): string | null {
  const { mcpServerNames } = ctx;
  const colors = ctx.config?.colors;

  if (!mcpServerNames || mcpServerNames.length === 0) {
    return null;
  }

  const shown = mcpServerNames.slice(0, MAX_MCP_SHOWN);
  const parts: string[] = [];

  for (const name of shown) {
    parts.push(`${yellow('◐')} ${cyan(name)}`);
  }

  const remaining = mcpServerNames.length - shown.length;
  if (remaining > 0) {
    parts.push(label(`+${remaining} more`, colors));
  }

  return parts.join(' | ');
}
