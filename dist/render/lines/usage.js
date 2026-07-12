import { isLimitReached } from "../../types.js";
import { shouldHideUsage } from "../../stdin.js";
import { critical, label, getQuotaColor, quotaBar, RESET } from "../colors.js";
import { getAdaptiveBarWidth } from "../../utils/terminal.js";
import { t } from "../../i18n/index.js";
import { progressLabel } from "./label-align.js";
import { formatResetTime } from "../format-reset-time.js";
const FIVE_HOUR_WINDOW_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export function renderUsageLine(ctx, alignLabels = false) {
    const display = ctx.config?.display;
    const colors = ctx.config?.colors;
    if (display?.showUsage === false) {
        return null;
    }
    if (!ctx.usageData) {
        return null;
    }
    if (shouldHideUsage(ctx.stdin)) {
        return null;
    }
    const usageLabel = progressLabel("label.usage", colors, alignLabels);
    const balanceLabel = ctx.usageData.balanceLabel ?? null;
    const modelScopedEntries = ctx.usageData.modelScoped ?? [];
    const hasWindowData = ctx.usageData.fiveHour !== null || ctx.usageData.sevenDay !== null || modelScopedEntries.length > 0;
    if (balanceLabel && !hasWindowData) {
        return `${usageLabel} ${balanceLabel}`;
    }
    const timeFormat = normalizeTimeFormat(display?.timeFormat);
    const showResetLabel = display?.showResetLabel ?? true;
    const resetsKey = limitResetTimeFormat(timeFormat) === 'absolute' ? "format.resets" : "format.resetsIn";
    const usageCompact = display?.usageCompact ?? false;
    const usageValueMode = display?.usageValue ?? 'percent';
    if (isLimitReached(ctx.usageData)) {
        const limitTimeFormat = limitResetTimeFormat(timeFormat);
        const resetTime = ctx.usageData.fiveHour === 100
            ? formatResetTime(ctx.usageData.fiveHourResetAt, limitTimeFormat)
            : formatResetTime(ctx.usageData.sevenDayResetAt, limitTimeFormat);
        if (usageCompact) {
            return appendBalance(critical(`⚠ Limit${resetTime ? ` (${resetTime})` : ""}`, colors), balanceLabel);
        }
        const resetSuffix = resetTime
            ? showResetLabel
                ? ` (${t(resetsKey)} ${resetTime})`
                : ` (${resetTime})`
            : "";
        return appendBalance(`${usageLabel} ${critical(`⚠ ${t("status.limitReached")}${resetSuffix}`, colors)}`, balanceLabel);
    }
    const threshold = display?.usageThreshold ?? 0;
    const fiveHour = ctx.usageData.fiveHour;
    const sevenDay = ctx.usageData.sevenDay;
    const effectiveUsage = Math.max(fiveHour ?? 0, sevenDay ?? 0, ...modelScopedEntries.map((entry) => entry.percent));
    if (effectiveUsage < threshold) {
        return balanceLabel ? `${usageLabel} ${balanceLabel}` : null;
    }
    const sevenDayThreshold = display?.sevenDayThreshold ?? 80;
    if (usageCompact) {
        const fiveHourPart = fiveHour !== null
            ? formatCompactWindowPart("5h", fiveHour, ctx.usageData.fiveHourResetAt, FIVE_HOUR_WINDOW_MS, timeFormat, colors, usageValueMode)
            : null;
        const sevenDayPart = (sevenDay !== null && (fiveHour === null || sevenDay >= sevenDayThreshold))
            ? formatCompactWindowPart("7d", sevenDay, ctx.usageData.sevenDayResetAt, SEVEN_DAY_WINDOW_MS, timeFormat, colors, usageValueMode)
            : null;
        // Minimal form: no reset suffix (duplicates the weekly window's) to keep
        // the line short enough not to wrap.
        const modelScopedCompactParts = modelScopedEntries.map((entry) => formatCompactWindowPart(entry.label, entry.percent, null, SEVEN_DAY_WINDOW_MS, timeFormat, colors, usageValueMode));
        const compactParts = [fiveHourPart, sevenDayPart, ...modelScopedCompactParts].filter((part) => Boolean(part));
        return compactParts.length > 0 ? appendBalance(compactParts.join(" | "), balanceLabel) : null;
    }
    const usageBarEnabled = display?.usageBarEnabled ?? true;
    const barWidth = getAdaptiveBarWidth();
    if (fiveHour === null && sevenDay !== null) {
        const weeklyOnlyPart = formatUsageWindowPart({
            label: t("label.weekly"),
            labelKey: "label.weekly",
            percent: sevenDay,
            resetAt: ctx.usageData.sevenDayResetAt,
            windowMs: SEVEN_DAY_WINDOW_MS,
            colors,
            usageBarEnabled,
            barWidth,
            timeFormat,
            showResetLabel,
            forceLabel: true,
            alignLabels,
            usageValueMode,
        });
        const weeklyModelScopedParts = formatModelScopedParts(modelScopedEntries, {
            colors,
            usageValueMode,
        });
        return appendBalance(`${usageLabel} ${[weeklyOnlyPart, ...weeklyModelScopedParts].join(" | ")}`, balanceLabel);
    }
    const fiveHourPart = formatUsageWindowPart({
        label: "5h",
        percent: fiveHour,
        resetAt: ctx.usageData.fiveHourResetAt,
        windowMs: FIVE_HOUR_WINDOW_MS,
        colors,
        usageBarEnabled,
        barWidth,
        timeFormat,
        showResetLabel,
        usageValueMode,
    });
    const modelScopedParts = formatModelScopedParts(modelScopedEntries, {
        colors,
        usageValueMode,
    });
    if (sevenDay !== null && sevenDay >= sevenDayThreshold) {
        const sevenDayPart = formatUsageWindowPart({
            label: t("label.weekly"),
            labelKey: "label.weekly",
            percent: sevenDay,
            resetAt: ctx.usageData.sevenDayResetAt,
            windowMs: SEVEN_DAY_WINDOW_MS,
            colors,
            usageBarEnabled,
            barWidth,
            timeFormat,
            showResetLabel,
            forceLabel: true,
            alignLabels,
            usageValueMode,
        });
        return appendBalance(`${usageLabel} ${[fiveHourPart, sevenDayPart, ...modelScopedParts].join(" | ")}`, balanceLabel);
    }
    return appendBalance(`${usageLabel} ${[fiveHourPart, ...modelScopedParts].join(" | ")}`, balanceLabel);
}
/**
 * Formats per-model weekly usage buckets (e.g. "Fable") as a minimal
 * "label percent" pair — no bar and no reset suffix. The reset time would
 * duplicate the Weekly window's (same weekly bucket), and the extra width
 * makes the usage line wrap in narrower terminals.
 */
function formatModelScopedParts(entries, opts) {
    if (!entries || entries.length === 0) {
        return [];
    }
    return entries.map((entry) => `${label(entry.label, opts.colors)} ${formatUsagePercent(entry.percent, opts.colors, opts.usageValueMode)}`);
}
function appendBalance(line, balanceLabel) {
    return balanceLabel ? `${line} | ${balanceLabel}` : line;
}
function formatCompactWindowPart(windowLabel, percent, resetAt, windowMs, timeFormat, colors, usageValueMode = 'percent') {
    const usageDisplay = formatUsagePercent(percent, colors, usageValueMode);
    const reset = formatWindowTime(resetAt, windowMs, timeFormat);
    const styledLabel = label(`${windowLabel}:`, colors);
    return reset
        ? `${styledLabel} ${usageDisplay} ${label(`(${reset})`, colors)}`
        : `${styledLabel} ${usageDisplay}`;
}
function formatUsagePercent(percent, colors, mode = 'percent') {
    if (percent === null) {
        return label("--", colors);
    }
    const color = getQuotaColor(percent, colors);
    const displayPercent = mode === 'remaining' ? Math.max(0, 100 - percent) : percent;
    return `${color}${displayPercent}%${RESET}`;
}
function formatUsageWindowPart({ label: windowLabel, labelKey, percent, resetAt, windowMs, colors, usageBarEnabled, barWidth, timeFormat = 'relative', showResetLabel, forceLabel = false, alignLabels = false, usageValueMode = 'percent', }) {
    const usageDisplay = formatUsagePercent(percent, colors, usageValueMode);
    const reset = formatWindowTime(resetAt, windowMs, timeFormat);
    const styledLabel = labelKey
        ? progressLabel(labelKey, colors, alignLabels)
        : label(windowLabel, colors);
    const showResetWording = timeFormat !== 'elapsed' && timeFormat !== 'elapsedAndAbsolute';
    const resetsKey = timeFormat === 'absolute' ? "format.resets" : "format.resetsIn";
    const resetSuffix = reset
        ? showResetLabel && showResetWording
            ? `(${t(resetsKey)} ${reset})`
            : `(${reset})`
        : "";
    if (usageBarEnabled) {
        const body = resetSuffix
            ? `${quotaBar(percent ?? 0, barWidth, colors)} ${usageDisplay} ${resetSuffix}`
            : `${quotaBar(percent ?? 0, barWidth, colors)} ${usageDisplay}`;
        return forceLabel ? `${styledLabel} ${body}` : body;
    }
    return resetSuffix
        ? `${styledLabel} ${usageDisplay} ${resetSuffix}`
        : `${styledLabel} ${usageDisplay}`;
}
function normalizeTimeFormat(value) {
    if (value === 'absolute'
        || value === 'both'
        || value === 'elapsed'
        || value === 'elapsedAndAbsolute') {
        return value;
    }
    return 'relative';
}
function limitResetTimeFormat(timeFormat) {
    if (timeFormat === 'elapsedAndAbsolute') {
        return 'absolute';
    }
    if (timeFormat === 'elapsed') {
        return 'relative';
    }
    return timeFormat;
}
function formatWindowTime(resetAt, windowMs, timeFormat) {
    if (timeFormat === 'elapsed') {
        return formatElapsedWindow(resetAt, windowMs);
    }
    if (timeFormat === 'elapsedAndAbsolute') {
        const elapsed = formatElapsedWindow(resetAt, windowMs);
        const absolute = formatResetTime(resetAt, 'absolute');
        if (elapsed && absolute) {
            return `${elapsed}, ${absolute}`;
        }
        return elapsed || absolute;
    }
    return formatResetTime(resetAt, timeFormat);
}
function formatElapsedWindow(resetAt, windowMs) {
    if (!resetAt) {
        return '';
    }
    const windowStart = resetAt.getTime() - windowMs;
    const rawElapsed = ((Date.now() - windowStart) / windowMs) * 100;
    const elapsed = Math.max(0, Math.min(100, Math.round(rawElapsed)));
    return `${elapsed}% elapsed`;
}
//# sourceMappingURL=usage.js.map