import type { RenderContext } from '../types.js';
import { cyan, green, label } from './colors.js';
import { sanitizeDisplayText } from '../utils/sanitize.js';

const SHORT_ID_LEN = 6;

/**
 * Render the SSH element: the session's SSH destinations, one per source —
 * the main agent first, then subagents (each tagged `sub#<short-id>`) — joined
 * with a middle dot. Returns null when disabled or when no targets were found.
 *
 *   ⚡ SSH main 44.245.72.210:22 · sub#a4ad71 10.0.0.5:2222
 */
export function renderSshLine(ctx: RenderContext): string | null {
  if (ctx.config?.display?.showSsh !== true) {
    return null;
  }

  const targets = ctx.transcript.sshTargets ?? [];
  if (targets.length === 0) {
    return null;
  }

  const colors = ctx.config?.colors;
  const parts = targets.map(target => {
    const hostPort = cyan(`${sanitizeDisplayText(target.host)}:${target.port}`);
    if (target.source === 'subagent') {
      const shortId = sanitizeDisplayText(target.agentId ?? '').slice(0, SHORT_ID_LEN);
      return `${label(`sub#${shortId}`, colors)} ${hostPort}`;
    }
    return `${label('main', colors)} ${hostPort}`;
  });

  return `${green('⚡')} SSH ${parts.join(' · ')}`;
}
