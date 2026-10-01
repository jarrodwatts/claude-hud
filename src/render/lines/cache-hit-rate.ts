import type { RenderContext } from '../../types.js';
import { label } from '../colors.js';
import { t } from '../../i18n/index.js';

// Cache reads as a share of all input tokens across the session.
export function renderCacheHitRateLine(ctx: RenderContext): string | null {
  const display = ctx.config?.display;
  if (display?.showCacheHitRate !== true) {
    return null;
  }

  const tokens = ctx.transcript.sessionTokens;
  if (!tokens) {
    return null;
  }

  const read = Math.max(0, tokens.cacheReadTokens);
  const created = Math.max(0, tokens.cacheCreationTokens);
  const input = Math.max(0, tokens.inputTokens);
  const total = input + read + created;
  if (total === 0) {
    return null;
  }

  const hitRate = (read / total) * 100;
  return `${label(t('label.cacheHitRate'), ctx.config?.colors)} ${hitRate.toFixed(1)}%`;
}
