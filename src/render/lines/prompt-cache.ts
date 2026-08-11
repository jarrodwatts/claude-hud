import type { RenderContext } from '../../types.js';
import { isDetectedPromptCacheTtl, PROMPT_CACHE_DEFAULT_TTL_SECONDS } from '../../constants.js';
import { getContextColor, RESET, label, warning as warningColor } from '../colors.js';
import { formatAbsoluteTime, type WallClockOptions } from '../format-reset-time.js';
import { t } from '../../i18n/index.js';

function getPromptCacheWarningSeconds(ttlSeconds: number): number {
  return Math.min(ttlSeconds, Math.max(60, Math.floor(ttlSeconds / 5)));
}

function colorPromptCacheValue(
  value: string,
  state: 'active' | 'warning' | 'expired',
  ctx: RenderContext,
): string {
  if (state === 'expired') {
    return label(value, ctx.config?.colors);
  }

  if (state === 'warning') {
    return warningColor(value, ctx.config?.colors);
  }

  return `${getContextColor(0, ctx.config?.colors)}${value}${RESET}`;
}

export function renderPromptCacheLine(ctx: RenderContext, now: number = Date.now()): string | null {
  const display = ctx.config?.display;
  if (!display?.showPromptCache) {
    return null;
  }

  const anchorAt = ctx.transcript.promptCacheAnchorAt;
  if (!anchorAt || Number.isNaN(anchorAt.getTime())) {
    return null;
  }

  // The TTL comes from the transcript, since every cache write records the tier
  // it used. The default applies only until the session's first cache write.
  const ttlSeconds = isDetectedPromptCacheTtl(ctx.transcript.promptCacheTtlSeconds)
    ? ctx.transcript.promptCacheTtlSeconds
    : PROMPT_CACHE_DEFAULT_TTL_SECONDS;

  const expiresAt = new Date(anchorAt.getTime() + ttlSeconds * 1000);
  const remainingMs = expiresAt.getTime() - now;
  const state = remainingMs <= 0
    ? 'expired'
    : remainingMs <= getPromptCacheWarningSeconds(ttlSeconds) * 1000
      ? 'warning'
      : 'active';

  // Expiry time rather than a countdown: the statusline only repaints while
  // Claude Code is active, so between turns — exactly when the cache is draining
  // — a countdown freezes at whatever it last displayed and keeps reporting it.
  // A clock time stays true however stale the render is.
  const wallClockOpts: WallClockOptions = {
    hourCycle: display.hourCycle ?? 'auto',
    showSeconds: display.showClockSeconds ?? false,
  };
  const value = state === 'expired'
    ? t('status.expired')
    : formatAbsoluteTime(expiresAt, new Date(now), wallClockOpts);

  return `${label(t('label.promptCache'), ctx.config?.colors)} ${colorPromptCacheValue(`⏱ ${value}`, state, ctx)}`;
}
