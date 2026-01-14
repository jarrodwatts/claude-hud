import type { RenderContext } from '../../types.js';
import { isLimitReached } from '../../types.js';
import { red, yellow, dim, getContextColor, RESET } from '../colors.js';

export function renderUsageLine(ctx: RenderContext): string | null {
  const display = ctx.config?.display;

  if (display?.showUsage === false) {
    return null;
  }

  if (!ctx.usageData?.planName) {
    return null;
  }

  if (ctx.usageData.apiUnavailable) {
    return yellow(`usage: ⚠`);
  }

  if (isLimitReached(ctx.usageData)) {
    const resetTime = ctx.usageData.fiveHour === 100
      ? formatResetTime(ctx.usageData.fiveHourResetAt)
      : formatResetTime(ctx.usageData.sevenDayResetAt);
    return red(`⚠ Limit reached${resetTime ? ` (resets ${resetTime})` : ''}`);
  }

  const threshold = display?.usageThreshold ?? 0;
  const fiveHour = ctx.usageData.fiveHour;
  const sevenDay = ctx.usageData.sevenDay;

  const effectiveUsage = Math.max(fiveHour ?? 0, sevenDay ?? 0);
  if (effectiveUsage < threshold) {
    return null;
  }

  const fiveHourDisplay = formatUsagePercent(ctx.usageData.fiveHour);
  const fiveHourReset = formatResetTime(ctx.usageData.fiveHourResetAt);
  const fiveHourPart = fiveHourReset
    ? `5h: ${fiveHourDisplay} (${fiveHourReset})`
    : `5h: ${fiveHourDisplay}`;

  if (sevenDay !== null && sevenDay >= 80) {
    const sevenDayDisplay = formatUsagePercent(sevenDay);
    return `${fiveHourPart} | 7d: ${sevenDayDisplay}`;
  }

  return fiveHourPart;
}

function formatUsagePercent(percent: number | null): string {
  if (percent === null) {
    return dim('--');
  }
  const color = getContextColor(percent);
  return `${color}${percent}%${RESET}`;
}

function formatResetTime(resetAt: Date | null): string {
  if (!resetAt) return '';
  const now = new Date();
  const diffMs = resetAt.getTime() - now.getTime();
  if (diffMs <= 0) return '';

  const diffMins = Math.ceil(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m`;

  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}
