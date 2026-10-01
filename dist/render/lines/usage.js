import { isLimitReached } from "../../types.js";
import { shouldHideUsage } from "../../stdin.js";
import { critical, label, getQuotaColor, quotaBar, RESET } from "../colors.js";
import { getAdaptiveBarWidth } from "../../utils/terminal.js";
import { t, interpolate } from "../../i18n/index.js";
import { progressLabel, } from "./label-align.js";
import { formatResetTime } from "../format-reset-time.js";
const FIVE_HOUR_WINDOW_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export function renderUsageLine(ctx, labelOptions = {}) {
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
    const usageLabel = progressLabel("label.usage", colors, labelOptions);
    const balanceLabel = ctx.usageData.balanceLabel ?? null;
    const scopedWindows = display?.showModelScopedUsage === false
        ? []
        : ctx.usageData.scopedWindows ?? [];
    const hasWindowData = ctx.usageData.fiveHour !== null
        || ctx.usageData.sevenDay !== null
        || scopedWindows.length > 0;
    if (balanceLabel && !hasWindowData) {
        return `${usageLabel} ${balanceLabel}`;
    }
    const timeFormat = normalizeTimeFormat(display?.timeFormat);
    const wallClockOpts = {
        hourCycle: display?.hourCycle ?? 'auto',
        showSeconds: display?.showClockSeconds ?? false,
    };
    const showResetLabel = display?.showResetLabel ?? true;
    const resetsKey = limitResetTimeFormat(timeFormat) === 'absolute' ? "format.resets" : "format.resetsIn";
    const usageCompact = display?.usageCompact ?? false;
    const usageValueMode = display?.usageValue ?? 'percent';
    const barWidthForScoped = getAdaptiveBarWidth();
    const scopedSuffix = scopedWindows.length
        ? ' | ' + scopedWindows
            .map((w) => usageCompact
            ? formatCompactWindowPart(w.label, w.percent, w.resetAt, SEVEN_DAY_WINDOW_MS, timeFormat, colors, usageValueMode, wallClockOpts)
            : formatUsageWindowPart({
                label: w.label,
                percent: w.percent,
                resetAt: w.resetAt,
                windowMs: SEVEN_DAY_WINDOW_MS,
                colors,
                usageBarEnabled: display?.usageBarEnabled ?? true,
                barWidth: barWidthForScoped,
                timeFormat,
                showResetLabel,
                forceLabel: true,
                labelOptions,
                usageValueMode,
                wallClockOpts,
            }))
            .join(' | ')
        : '';
    if (isLimitReached(ctx.usageData)) {
        const limitTimeFormat = limitResetTimeFormat(timeFormat);
        const resetTime = ctx.usageData.fiveHour === 100
            ? formatResetTime(ctx.usageData.fiveHourResetAt, limitTimeFormat, wallClockOpts)
            : formatResetTime(ctx.usageData.sevenDayResetAt, limitTimeFormat, wallClockOpts);
        if (usageCompact) {
            return appendBalance(`${critical(`⚠ Limit${resetTime ? ` (${resetTime})` : ""}`, colors)}${scopedSuffix}`, balanceLabel);
        }
        const resetSuffix = resetTime
            ? showResetLabel
                ? ` (${t(resetsKey)} ${resetTime})`
                : ` (${resetTime})`
            : "";
        return appendBalance(`${usageLabel} ${critical(`⚠ ${t("status.limitReached")}${resetSuffix}`, colors)}${scopedSuffix}`, balanceLabel);
    }
    const threshold = display?.usageThreshold ?? 0;
    const fiveHour = ctx.usageData.fiveHour;
    const sevenDay = ctx.usageData.sevenDay;
    const effectiveUsage = Math.max(fiveHour ?? 0, sevenDay ?? 0, ...scopedWindows.map((window) => window.percent ?? 0));
    if (effectiveUsage < threshold) {
        return balanceLabel ? `${usageLabel} ${balanceLabel}` : null;
    }
    const sevenDayThreshold = display?.sevenDayThreshold ?? 80;
    if (usageCompact) {
        const fiveHourPart = fiveHour !== null
            ? formatCompactWindowPart("5h", fiveHour, ctx.usageData.fiveHourResetAt, FIVE_HOUR_WINDOW_MS, timeFormat, colors, usageValueMode, wallClockOpts)
            : null;
        const sevenDayPart = (sevenDay !== null && (fiveHour === null || sevenDay >= sevenDayThreshold))
            ? formatCompactWindowPart("7d", sevenDay, ctx.usageData.sevenDayResetAt, SEVEN_DAY_WINDOW_MS, timeFormat, colors, usageValueMode, wallClockOpts)
            : null;
        if (fiveHourPart && sevenDayPart) {
            return appendBalance(`${fiveHourPart} | ${sevenDayPart}${scopedSuffix}`, balanceLabel);
        }
        const compactLine = fiveHourPart ?? sevenDayPart;
        if (compactLine) {
            return appendBalance(`${compactLine}${scopedSuffix}`, balanceLabel);
        }
        return scopedSuffix ? appendBalance(scopedSuffix.slice(3), balanceLabel) : null;
    }
    const usageBarEnabled = display?.usageBarEnabled ?? true;
    const barWidth = getAdaptiveBarWidth();
    if (fiveHour === null && sevenDay === null) {
        return scopedSuffix
            ? appendBalance(`${usageLabel} ${scopedSuffix.slice(3)}`, balanceLabel)
            : balanceLabel
                ? `${usageLabel} ${balanceLabel}`
                : null;
    }
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
            labelOptions,
            usageValueMode,
            wallClockOpts,
        });
        return appendBalance(`${usageLabel} ${weeklyOnlyPart}${scopedSuffix}`, balanceLabel);
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
        wallClockOpts,
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
            labelOptions,
            usageValueMode,
            wallClockOpts,
        });
        return appendBalance(`${usageLabel} ${fiveHourPart} | ${sevenDayPart}${scopedSuffix}`, balanceLabel);
    }
    return appendBalance(`${usageLabel} ${fiveHourPart}${scopedSuffix}`, balanceLabel);
}
function appendBalance(line, balanceLabel) {
    return balanceLabel ? `${line} | ${balanceLabel}` : line;
}
function formatCompactWindowPart(windowLabel, percent, resetAt, windowMs, timeFormat, colors, usageValueMode = 'percent', wallClockOpts) {
    const usageDisplay = formatUsagePercent(percent, colors, usageValueMode);
    const reset = formatWindowTime(resetAt, windowMs, timeFormat, wallClockOpts);
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
function formatUsageWindowPart({ label: windowLabel, labelKey, percent, resetAt, windowMs, colors, usageBarEnabled, barWidth, timeFormat = 'relative', showResetLabel, forceLabel = false, labelOptions = {}, usageValueMode = 'percent', wallClockOpts, }) {
    const usageDisplay = formatUsagePercent(percent, colors, usageValueMode);
    const reset = formatWindowTime(resetAt, windowMs, timeFormat, wallClockOpts);
    const styledLabel = labelKey
        ? progressLabel(labelKey, colors, labelOptions)
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
function formatWindowTime(resetAt, windowMs, timeFormat, wallClockOpts) {
    if (timeFormat === 'elapsed') {
        return formatElapsedWindow(resetAt, windowMs);
    }
    if (timeFormat === 'elapsedAndAbsolute') {
        const elapsed = formatElapsedWindow(resetAt, windowMs);
        const absolute = formatResetTime(resetAt, 'absolute', wallClockOpts);
        if (elapsed && absolute) {
            return `${elapsed}, ${absolute}`;
        }
        return elapsed || absolute;
    }
    return formatResetTime(resetAt, timeFormat, wallClockOpts);
}
function formatElapsedWindow(resetAt, windowMs) {
    if (!resetAt) {
        return '';
    }
    const windowStart = resetAt.getTime() - windowMs;
    const rawElapsed = ((Date.now() - windowStart) / windowMs) * 100;
    const elapsed = Math.max(0, Math.min(100, Math.round(rawElapsed)));
    return interpolate(t("format.elapsed"), { value: elapsed });
}
//# sourceMappingURL=usage.js.map