import type { ContextUsage } from '../stdin.js';

/** `1.2M`, `45k`, or `800`. */
export function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return n.toString();
}

// percent → "45%", tokens → "45k/200k", remaining → "55%", both → "45% (45k/200k)".
export function formatContextValue(
  context: ContextUsage,
  mode: 'percent' | 'tokens' | 'remaining' | 'both',
): string {
  const { percent, tokens, size } = context;
  const ratio = size > 0 ? `${formatTokens(tokens)}/${formatTokens(size)}` : formatTokens(tokens);
  if (mode === 'tokens') return ratio;
  if (mode === 'both') return size > 0 ? `${percent}% (${ratio})` : `${percent}%`;
  if (mode === 'remaining') return `${Math.max(0, 100 - percent)}%`;
  return `${percent}%`;
}

export function formatSessionDuration(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}
