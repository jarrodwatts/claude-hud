import type { RenderContext } from '../../types.js';
import { label } from '../colors.js';
import { t } from '../../i18n/index.js';

/**
 * Session-wide prompt-cache hit rate:
 *
 *   hit_rate = cacheRead / (input + cacheRead + cacheCreation)
 *
 * `cacheRead` / `cacheCreation` are cumulative from the already-deduped
 * `TranscriptData.sessionTokens` totals (`src/transcript.ts`). `input` is the
 * cumulative non-cached input — including it in the denominator means the rate
 * reflects "what fraction of the server-processed input came from cache",
 * which is bounded in [0%, 100%] and stable turn-over-turn.
 *
 * Only the percentage is rendered; absolute counts are visible in the
 * `Tokens` line. Hidden when the user has not opted in via
 * `display.showCacheHitRate`, when no transcript has been parsed yet, or
 * when the session has no input activity at all.
 */
export function renderCacheHitRateLine(ctx: RenderContext): string | null {
  const display = ctx.config?.display;
  if (display?.showCacheHitRate !== true) {
    return null;
  }

  const tokens = ctx.transcript.sessionTokens;
  if (!tokens) {
    return null;
  }

  // Clamp to zero: transcript accumulation floors deltas at zero (see
  // `accumulateMessageUsage` in `src/transcript.ts`), but defensive guarding
  // here keeps a malformed transcript from rendering a negative percent.
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