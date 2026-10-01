import type { RenderContext } from '../../types.js';
import { formatUsd } from '../../cost.js';
import { t } from '../../i18n/index.js';
import { label } from '../colors.js';
import { sessionCostUsd } from '../derive.js';

export function renderCostEstimate(ctx: RenderContext): string | null {
  const display = ctx.config?.display;
  const parts: string[] = [];

  const costUsd = display?.showCost === true ? sessionCostUsd(ctx) : null;
  if (costUsd !== null) {
    parts.push(`${t('label.cost')} ${formatUsd(costUsd)}`);
  }
  if (display?.showDailyCost === true && ctx.costTotals) {
    parts.push(`${t('label.today')} ${formatUsd(ctx.costTotals.todayUsd)}`);
  }
  if (display?.showWeeklyCost === true && ctx.costTotals?.weekUsd != null) {
    parts.push(`${t('label.week')} ${formatUsd(ctx.costTotals.weekUsd)}`);
  }

  return parts.length > 0 ? label(parts.join(' | '), ctx.config?.colors) : null;
}
