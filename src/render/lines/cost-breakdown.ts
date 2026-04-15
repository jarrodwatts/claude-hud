import type { RenderContext, SessionTokenUsage } from '../../types.js';
import { t } from '../../i18n/index.js';
import { label } from '../colors.js';

function formatTokens(n: number): string {
  if (n >= 1000000) {
    return `${(n / 1000000).toFixed(1)}M`;
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(0)}k`;
  }
  return n.toString();
}

function formatBreakdown(tokens: SessionTokenUsage): string {
  const parts = [
    `${formatTokens(tokens.inputTokens)} ${t('format.in')}`,
    `${formatTokens(tokens.outputTokens)} ${t('format.out')}`,
    `${formatTokens(tokens.cacheCreationTokens)} ${t('format.cacheWrite')}`,
    `${formatTokens(tokens.cacheReadTokens)} ${t('format.cacheRead')}`,
  ];
  return parts.join(' · ');
}

export function renderCostBreakdownLine(ctx: RenderContext): string | null {
  if (ctx.config?.display?.showCostBreakdown !== true) {
    return null;
  }
  const tokens = ctx.transcript.sessionTokens;
  if (!tokens) {
    return null;
  }
  const total = tokens.inputTokens
    + tokens.outputTokens
    + tokens.cacheCreationTokens
    + tokens.cacheReadTokens;
  if (total === 0) {
    return null;
  }
  return label(formatBreakdown(tokens), ctx.config?.colors);
}
