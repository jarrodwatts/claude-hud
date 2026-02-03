import { isLimitReached } from '../../types.js';
import { getContextPercent, getBufferedPercent, getModelName, getProviderLabel, getTotalTokens } from '../../stdin.js';
import { getOutputSpeed } from '../../speed-tracker.js';
import { coloredBar, cyan, dim, red, yellow, getContextColor, quotaBar, RESET } from '../colors.js';
const DEBUG = process.env.DEBUG?.includes('claude-hud') || process.env.DEBUG === '*';
export function renderIdentityLine(ctx) {
    const model = getModelName(ctx.stdin);
    const rawPercent = getContextPercent(ctx.stdin);
    const bufferedPercent = getBufferedPercent(ctx.stdin);
    const autocompactMode = ctx.config?.display?.autocompactBuffer ?? 'enabled';
    const percent = autocompactMode === 'disabled' ? rawPercent : bufferedPercent;
    if (DEBUG && autocompactMode === 'disabled') {
        console.error(`[claude-hud:context] autocompactBuffer=disabled, showing raw ${rawPercent}% (buffered would be ${bufferedPercent}%)`);
    }
    const bar = coloredBar(percent);
    const display = ctx.config?.display;
    const parts = [];
    const contextValueMode = display?.contextValue ?? 'percent';
    const contextValue = formatContextValue(ctx, percent, contextValueMode);
    const contextValueDisplay = `${getContextColor(percent)}${contextValue}${RESET}`;
    const providerLabel = getProviderLabel(ctx.stdin);
    const planName = display?.showUsage !== false ? ctx.usageData?.planName : undefined;
    const planDisplay = providerLabel ?? planName;
    const modelDisplay = planDisplay ? `${model} | ${planDisplay}` : model;
    if (display?.showModel !== false && display?.showContextBar !== false) {
        parts.push(`${cyan(`[${modelDisplay}]`)} ${bar} ${contextValueDisplay}`);
    }
    else if (display?.showModel !== false) {
        parts.push(`${cyan(`[${modelDisplay}]`)} ${contextValueDisplay}`);
    }
    else if (display?.showContextBar !== false) {
        parts.push(`${bar} ${contextValueDisplay}`);
    }
    else {
        parts.push(contextValueDisplay);
    }
    // Inline usage bar (only when usageBarEnabled is true in expanded mode)
    const usageBarEnabled = display?.usageBarEnabled ?? true;
    if (usageBarEnabled && display?.showUsage !== false && ctx.usageData?.planName && !providerLabel) {
        const usagePart = renderInlineUsage(ctx);
        if (usagePart) {
            parts.push(usagePart);
        }
    }
    if (display?.showSpeed) {
        const speed = getOutputSpeed(ctx.stdin);
        if (speed !== null) {
            parts.push(dim(`out: ${speed.toFixed(1)} tok/s`));
        }
    }
    if (display?.showDuration !== false && ctx.sessionDuration) {
        parts.push(dim(`⏱️  ${ctx.sessionDuration}`));
    }
    let line = parts.join(' | ');
    if (display?.showTokenBreakdown !== false && percent >= 85) {
        const usage = ctx.stdin.context_window?.current_usage;
        if (usage) {
            const input = formatTokens(usage.input_tokens ?? 0);
            const cache = formatTokens((usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0));
            line += dim(` (in: ${input}, cache: ${cache})`);
        }
    }
    return line;
}
function formatTokens(n) {
    if (n >= 1000000) {
        return `${(n / 1000000).toFixed(1)}M`;
    }
    if (n >= 1000) {
        return `${(n / 1000).toFixed(0)}k`;
    }
    return n.toString();
}
function formatContextValue(ctx, percent, mode) {
    if (mode === 'tokens') {
        const totalTokens = getTotalTokens(ctx.stdin);
        const size = ctx.stdin.context_window?.context_window_size ?? 0;
        if (size > 0) {
            return `${formatTokens(totalTokens)}/${formatTokens(size)}`;
        }
        return formatTokens(totalTokens);
    }
    return `${percent}%`;
}
function renderInlineUsage(ctx) {
    if (!ctx.usageData?.planName) {
        return null;
    }
    if (ctx.usageData.apiUnavailable) {
        const errorHint = formatUsageError(ctx.usageData.apiError);
        return yellow(`⚠${errorHint}`);
    }
    if (isLimitReached(ctx.usageData)) {
        const resetTime = ctx.usageData.fiveHour === 100
            ? formatResetTime(ctx.usageData.fiveHourResetAt)
            : formatResetTime(ctx.usageData.sevenDayResetAt);
        return red(`⚠ Limit${resetTime ? ` (${resetTime})` : ''}`);
    }
    const display = ctx.config?.display;
    const threshold = display?.usageThreshold ?? 0;
    const fiveHour = ctx.usageData.fiveHour;
    const sevenDay = ctx.usageData.sevenDay;
    const effectiveUsage = Math.max(fiveHour ?? 0, sevenDay ?? 0);
    if (effectiveUsage < threshold) {
        return null;
    }
    const fiveHourDisplay = formatUsagePercent(fiveHour);
    const fiveHourReset = formatResetTime(ctx.usageData.fiveHourResetAt);
    const fiveHourPart = fiveHourReset
        ? `${quotaBar(fiveHour ?? 0)} ${fiveHourDisplay} (${fiveHourReset} / 5h)`
        : `${quotaBar(fiveHour ?? 0)} ${fiveHourDisplay}`;
    const sevenDayThreshold = display?.sevenDayThreshold ?? 80;
    if (sevenDay !== null && sevenDay >= sevenDayThreshold) {
        const sevenDayDisplay = formatUsagePercent(sevenDay);
        const sevenDayReset = formatResetTime(ctx.usageData.sevenDayResetAt);
        const sevenDayPart = sevenDayReset
            ? `${quotaBar(sevenDay)} ${sevenDayDisplay} (${sevenDayReset} / 7d)`
            : `${quotaBar(sevenDay)} ${sevenDayDisplay}`;
        return `${fiveHourPart} | ${sevenDayPart}`;
    }
    return fiveHourPart;
}
function formatUsagePercent(percent) {
    if (percent === null) {
        return dim('--');
    }
    const color = getContextColor(percent);
    return `${color}${percent}%${RESET}`;
}
function formatUsageError(error) {
    if (!error)
        return '';
    if (error.startsWith('http-')) {
        return ` (${error.slice(5)})`;
    }
    return ` (${error})`;
}
function formatResetTime(resetAt) {
    if (!resetAt)
        return '';
    const now = new Date();
    const diffMs = resetAt.getTime() - now.getTime();
    if (diffMs <= 0)
        return '';
    const diffMins = Math.ceil(diffMs / 60000);
    if (diffMins < 60)
        return `${diffMins}m`;
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}
//# sourceMappingURL=identity.js.map