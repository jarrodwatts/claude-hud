import type { RenderContext } from '../../types.js';
import { getContextColor, RESET, label, warning as warningColor } from '../colors.js';
import { formatAbsoluteTime } from '../format-reset-time.js';
import { t } from '../../i18n/index.js';

const TTL_SECONDS: Record<string, number> = { '5m': 300, '1h': 3600 };

// Shows the expiry time rather than a countdown: between turns, exactly when the cache
// drains, the statusline isn't repainted and a countdown would freeze.
export function renderPromptCacheLine(ctx: RenderContext, now: number = Date.now()): string | null {
  const display = ctx.config?.display;
  const cache = ctx.stdin.prompt_cache;
  if (!display?.showPromptCache || !cache?.caching_observed) {
    return null;
  }

  const expiresAtMs = typeof cache.expires_at === 'number' ? cache.expires_at * 1000 : 0;
  const remainingMs = cache.warm ? expiresAtMs - now : 0;
  const colors = ctx.config?.colors;
  let value: string;
  if (remainingMs <= 0) {
    value = label(`⏱ ${t('status.expired')}`, colors);
  } else {
    const ttlSeconds = TTL_SECONDS[cache.ttl ?? ''] ?? 300;
    const warnMs = Math.max(60, Math.floor(ttlSeconds / 5)) * 1000;
    const until = formatAbsoluteTime(new Date(expiresAtMs), new Date(now), {
      hourCycle: display.hourCycle ?? 'auto',
      showSeconds: display.showClockSeconds ?? false,
    }, 'format.untilTime');
    value = remainingMs <= warnMs
      ? warningColor(`⏱ ${until}`, colors)
      : `${getContextColor(0, colors)}⏱ ${until}${RESET}`;
  }
  return `${label(t('label.promptCache'), colors)} ${value}`;
}
