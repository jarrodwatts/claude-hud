import type { RenderContext } from '../../types.js';
import { resolveSessionCost, formatUsd } from '../../cost.js';
import { t } from '../../i18n/index.js';
import { label } from '../colors.js';

export function renderCostEstimate(ctx: RenderContext): string | null {
  if (ctx.config?.display?.showCost !== true) {
    return null;
  }

  const cost = resolveSessionCost(ctx.stdin, ctx.transcript.sessionTokens, {
    allowRoutedCost: ctx.config?.display?.showRoutedCost === true,
  });
  if (!cost) {
    return null;
  }

  const labelKey = cost.source === 'native' ? 'label.cost' : 'label.estimatedCost';
  return label(`${t(labelKey)} ${formatUsd(cost.totalUsd)}`, ctx.config?.colors);
}
