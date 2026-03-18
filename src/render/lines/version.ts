import type { RenderContext } from '../../types.js';
import { dim } from '../colors.js';

export function renderVersionLine(ctx: RenderContext): string | null {
  if (ctx.config?.display?.showClaudeCodeVersion !== true) {
    return null;
  }

  if (!ctx.claudeCodeVersion) {
    return null;
  }

  return dim(`CC v${ctx.claudeCodeVersion}`);
}
