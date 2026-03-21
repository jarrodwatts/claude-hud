import type { RenderContext } from '../types.js';
import { getTotalTokens } from '../stdin.js';
import { dim, getQuotaColor, RESET } from '../render/colors.js';

export function formatTokens(n: number): string {
  if (n >= 1000000) {
    return `${(n / 1000000).toFixed(1)}M`;
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(0)}k`;
  }
  return n.toString();
}

export function formatContextValue(ctx: RenderContext, percent: number, mode: 'percent' | 'tokens' | 'remaining'): string {
  if (mode === 'tokens') {
    const totalTokens = getTotalTokens(ctx.stdin);
    const size = ctx.stdin.context_window?.context_window_size ?? 0;
    if (size > 0) {
      return `${formatTokens(totalTokens)}/${formatTokens(size)}`;
    }
    return formatTokens(totalTokens);
  }

  if (mode === 'remaining') {
    return `${Math.max(0, 100 - percent)}%`;
  }

  return `${percent}%`;
}

export function formatResetTime(resetAt: Date | null): string {
  if (!resetAt) return '';
  const now = new Date();
  const diffMs = resetAt.getTime() - now.getTime();
  if (diffMs <= 0) return '';

  const diffMins = Math.ceil(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m`;

  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    if (remHours > 0) return `${days}d ${remHours}h`;
    return `${days}d`;
  }

  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

export function formatUsageError(error?: string): string {
  if (!error) return '';
  if (error === 'rate-limited') return ' (syncing...)';
  if (error.startsWith('http-')) return ` (${error.slice(5)})`;
  return ` (${error})`;
}

export function formatUsagePercent(percent: number | null, colors?: RenderContext['config']['colors']): string {
  if (percent === null) {
    return dim('--');
  }
  const color = getQuotaColor(percent, colors);
  return `${color}${percent}%${RESET}`;
}
