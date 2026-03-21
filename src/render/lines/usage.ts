import type { RenderContext } from '../../types.js';
import { isLimitReached } from '../../types.js';
import { getProviderLabel } from '../../stdin.js';
import { critical, warning, dim, quotaBar } from '../colors.js';
import { getAdaptiveBarWidth } from '../../utils/terminal.js';
import { formatResetTime, formatUsageError, formatUsagePercent } from '../../utils/format.js';

export function renderUsageLine(ctx: RenderContext): string | null {
  const display = ctx.config?.display;
  const colors = ctx.config?.colors;

  if (display?.showUsage === false) {
    return null;
  }

  if (!ctx.usageData?.planName) {
    return null;
  }

  if (getProviderLabel(ctx.stdin)) {
    return null;
  }

  const label = dim('Usage');

  if (ctx.usageData.apiUnavailable) {
    const errorHint = formatUsageError(ctx.usageData.apiError);
    return `${label} ${warning(`⚠${errorHint}`, colors)}`;
  }

  if (isLimitReached(ctx.usageData)) {
    const resetTime = ctx.usageData.fiveHour === 100
      ? formatResetTime(ctx.usageData.fiveHourResetAt)
      : formatResetTime(ctx.usageData.sevenDayResetAt);
    return `${label} ${critical(`⚠ Limit reached${resetTime ? ` (resets ${resetTime})` : ''}`, colors)}`;
  }

  const threshold = display?.usageThreshold ?? 0;
  const fiveHour = ctx.usageData.fiveHour;
  const sevenDay = ctx.usageData.sevenDay;

  const effectiveUsage = Math.max(fiveHour ?? 0, sevenDay ?? 0);
  if (effectiveUsage < threshold) {
    return null;
  }

  const fiveHourDisplay = formatUsagePercent(ctx.usageData.fiveHour, colors);
  const fiveHourReset = formatResetTime(ctx.usageData.fiveHourResetAt);

  const usageBarEnabled = display?.usageBarEnabled ?? true;
  const barStyle = display?.barStyle ?? 'classic';
  const fiveHourPart = usageBarEnabled
    ? (fiveHourReset
        ? `${quotaBar(fiveHour ?? 0, getAdaptiveBarWidth(), colors, barStyle)} ${fiveHourDisplay} (resets in ${fiveHourReset})`
        : `${quotaBar(fiveHour ?? 0, getAdaptiveBarWidth(), colors, barStyle)} ${fiveHourDisplay}`)
    : (fiveHourReset
        ? `5h: ${fiveHourDisplay} (resets in ${fiveHourReset})`
        : `5h: ${fiveHourDisplay}`);

  const sevenDayThreshold = display?.sevenDayThreshold ?? 80;
  const syncingSuffix = ctx.usageData.apiError === 'rate-limited'
    ? ` ${dim('(syncing...)')}`
    : '';
  if (sevenDay !== null && sevenDay >= sevenDayThreshold) {
    const sevenDayDisplay = formatUsagePercent(sevenDay, colors);
    const sevenDayReset = formatResetTime(ctx.usageData.sevenDayResetAt);
    const sevenDayPart = usageBarEnabled
      ? (sevenDayReset
          ? `${quotaBar(sevenDay, getAdaptiveBarWidth(), colors, barStyle)} ${sevenDayDisplay} (resets in ${sevenDayReset})`
          : `${quotaBar(sevenDay, getAdaptiveBarWidth(), colors, barStyle)} ${sevenDayDisplay}`)
      : (sevenDayReset
          ? `7d: ${sevenDayDisplay} (resets in ${sevenDayReset})`
          : `7d: ${sevenDayDisplay}`);
    return `${label} ${fiveHourPart} ${dim('│')} ${sevenDayPart}${syncingSuffix}`;
  }

  return `${label} ${fiveHourPart}${syncingSuffix}`;
}

