import type { RenderContext } from '../../types.js';
import { estimateSessionCost, formatUsd } from '../../cost.js';
import { t } from '../../i18n/index.js';
import { label } from '../colors.js';

export function renderCostEstimate(ctx: RenderContext): string | null {
  if (ctx.config?.display?.showCost !== true) {
    return null;
  }

  const estimate = estimateSessionCost(ctx.stdin, ctx.transcript.sessionTokens);
  if (!estimate) {
    return null;
  }

  return label(`${t('label.estimatedCost')} ${formatUsd(estimate.totalUsd)}`, ctx.config?.colors);
}
