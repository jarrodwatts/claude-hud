import { resolveSessionCost, formatUsd } from '../../cost.js';
import { getCostTotals } from '../../daily-cost.js';
import { t } from '../../i18n/index.js';
import { label } from '../colors.js';
export function renderCostEstimate(ctx) {
    const display = ctx.config?.display;
    const allowRoutedCost = display?.showRoutedCost === true;
    const parts = [];
    if (display?.showCost === true) {
        const cost = resolveSessionCost(ctx.stdin, ctx.transcript.sessionTokens, {
            allowRoutedCost,
        });
        if (cost) {
            const labelKey = cost.source === 'native' ? 'label.cost' : 'label.estimatedCost';
            parts.push(`${t(labelKey)} ${formatUsd(cost.totalUsd)}`);
        }
    }
    if (display?.showDailyCost === true || display?.showWeeklyCost === true) {
        const totals = getCostTotals(ctx.stdin, {
            allowRoutedCost,
            sevenDayResetAt: ctx.usageData?.sevenDayResetAt ?? null,
        });
        if (totals !== null) {
            if (display?.showDailyCost === true) {
                parts.push(`${t('label.today')} ${formatUsd(totals.todayUsd)}`);
            }
            if (display?.showWeeklyCost === true && totals.weekUsd !== null) {
                parts.push(`${t('label.week')} ${formatUsd(totals.weekUsd)}`);
            }
        }
    }
    if (parts.length === 0) {
        return null;
    }
    return label(parts.join(' | '), ctx.config?.colors);
}
//# sourceMappingURL=cost.js.map