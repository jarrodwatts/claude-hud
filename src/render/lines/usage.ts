import type { RenderContext } from '../../types.js';
import { isLimitReached } from '../../types.js';
import { getProviderLabel } from '../../stdin.js';
import { red, yellow, dim, getContextColor, quotaBar, RESET } from '../colors.js';

export function renderUsageLine(ctx: RenderContext): string | null {
  const display = ctx.config?.display;

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
    return `${label} ${yellow(`⚠${errorHint}`)}`;
  }

  if (isLimitReached(ctx.usageData)) {
    const resetTime = ctx.usageData.fiveHour === 100
      ? formatResetTime(ctx.usageData.fiveHourResetAt)
      : formatResetTime(ctx.usageData.sevenDayResetAt);
    let limitMsg = red(`⚠ Limit reached${resetTime ? ` (resets ${resetTime})` : ''}`);
    // Show Extra Usage even when limit reached
    if (ctx.usageData.extraUsage?.isEnabled) {
      const extra = ctx.usageData.extraUsage;
      const usageBarEnabled = (ctx.config?.display?.usageBarEnabled ?? true);
      const extraUtil = extra.utilization ?? (extra.monthlyLimit && extra.monthlyLimit > 0 ? Math.round(((extra.usedCredits ?? 0) / extra.monthlyLimit) * 100) : 0);
      const extraPart = usageBarEnabled
        ? `${quotaBar(extraUtil)} ${formatUsagePercent(extraUtil)} Extra`
        : `Extra: ${formatUsagePercent(extraUtil)}`;
      limitMsg += ` | ${extraPart}`;
    }
    return `${label} ${limitMsg}`;
  }

  const threshold = display?.usageThreshold ?? 0;
  const fiveHour = ctx.usageData.fiveHour;
  const sevenDay = ctx.usageData.sevenDay;

  const effectiveUsage = Math.max(fiveHour ?? 0, sevenDay ?? 0);
  if (effectiveUsage < threshold) {
    return null;
  }

  const parts: string[] = [];
  const fiveHourDisplay = formatUsagePercent(ctx.usageData.fiveHour);
  const fiveHourReset = formatResetTime(ctx.usageData.fiveHourResetAt);

  const usageBarEnabled = display?.usageBarEnabled ?? true;
  const fiveHourPart = usageBarEnabled
    ? (fiveHourReset
        ? `${quotaBar(fiveHour ?? 0)} ${fiveHourDisplay} (${fiveHourReset} / 5h)`
        : `${quotaBar(fiveHour ?? 0)} ${fiveHourDisplay}`)
    : (fiveHourReset
        ? `5h: ${fiveHourDisplay} (${fiveHourReset})`
        : `5h: ${fiveHourDisplay}`);
  parts.push(fiveHourPart);

  const sevenDayThreshold = display?.sevenDayThreshold ?? 80;
  if (sevenDay !== null && sevenDay >= sevenDayThreshold) {
    const sevenDayDisplay = formatUsagePercent(sevenDay);
    const sevenDayReset = formatResetTime(ctx.usageData.sevenDayResetAt);
    const sevenDayPart = usageBarEnabled
      ? (sevenDayReset
          ? `${quotaBar(sevenDay)} ${sevenDayDisplay} (${sevenDayReset} / 7d)`
          : `${quotaBar(sevenDay)} ${sevenDayDisplay}`)
      : `7d: ${sevenDayDisplay}`;
    parts.push(sevenDayPart);
  }

  // Extra Usage
  if (ctx.usageData.extraUsage?.isEnabled) {
    const extra = ctx.usageData.extraUsage;
    const extraUtil = extra.utilization ?? (extra.monthlyLimit && extra.monthlyLimit > 0 ? Math.round(((extra.usedCredits ?? 0) / extra.monthlyLimit) * 100) : 0);
    const extraPart = usageBarEnabled
      ? `${quotaBar(extraUtil)} ${formatUsagePercent(extraUtil)} Extra`
      : `Extra: ${formatUsagePercent(extraUtil)}`;
    parts.push(extraPart);
  }

  return `${label} ${parts.join(' | ')}`;
}

function formatUsagePercent(percent: number | null): string {
  if (percent === null) {
    return dim('--');
  }
  const color = getContextColor(percent);
  return `${color}${percent}%${RESET}`;
}

function formatUsageError(error?: string): string {
  if (!error) return '';
  if (error.startsWith('http-')) {
    return ` (${error.slice(5)})`;
  }
  return ` (${error})`;
}

function formatResetTime(resetAt: Date | null): string {
  if (!resetAt) return '';
  const now = new Date();
  const diffMs = resetAt.getTime() - now.getTime();
  if (diffMs <= 0) return '';

  const diffMins = Math.ceil(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m`;

  const totalHours = Math.floor(diffMins / 60);
  if (totalHours < 24) {
    const mins = diffMins % 60;
    return mins > 0 ? `${totalHours}h ${mins}m` : `${totalHours}h`;
  }

  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (hours > 0) {
    return `${days}d ${hours}h`;
  }
  return `${days}d`;
}
