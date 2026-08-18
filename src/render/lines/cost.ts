import type { RenderContext } from '../../types.js';
import { resolveSessionCost, formatUsd } from '../../cost.js';
import { getDailyCostUsd } from '../../daily-cost.js';
import { t } from '../../i18n/index.js';
import { label } from '../colors.js';

export function renderCostEstimate(ctx: RenderContext): string | null {
  const display = ctx.config?.display;
  const allowRoutedCost = display?.showRoutedCost === true;
  const parts: string[] = [];

  if (display?.showCost === true) {
    const cost = resolveSessionCost(ctx.stdin, ctx.transcript.sessionTokens, {
      allowRoutedCost,
    });
    if (cost) {
      const labelKey = cost.source === 'native' ? 'label.cost' : 'label.estimatedCost';
      parts.push(`${t(labelKey)} ${formatUsd(cost.totalUsd)}`);
    }
  }

  if (display?.showDailyCost === true) {
    const dailyUsd = getDailyCostUsd(ctx.stdin, { allowRoutedCost });
    if (dailyUsd !== null) {
      parts.push(`${t('label.today')} ${formatUsd(dailyUsd)}`);
    }
  }

  if (parts.length === 0) {
    return null;
  }

  return label(parts.join(' | '), ctx.config?.colors);
}
