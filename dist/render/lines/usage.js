import { isLimitReached } from "../../types.js";
import { isBedrockModelId } from "../../stdin.js";
import { critical, label, getQuotaColor, quotaBar, RESET } from "../colors.js";
import { getAdaptiveBarWidth } from "../../utils/terminal.js";
import { t } from "../../i18n/index.js";
import { progressLabel } from "./label-align.js";
import { formatResetTime } from "../format-reset-time.js";
export function renderUsageLine(ctx, alignLabels = false) {
    const display = ctx.config?.display;
    const colors = ctx.config?.colors;
    if (display?.showUsage === false) {
        return null;
    }
    if (!ctx.usageData) {
        return null;
    }
    if (isBedrockModelId(ctx.stdin.model?.id)) {
        return null;
    }
    const usageLabel = progressLabel("label.usage", colors, alignLabels);
    const timeFormat = display?.timeFormat ?? 'relative';
    const showResetLabel = display?.showResetLabel ?? true;
    const resetsKey = timeFormat === 'absolute' ? "format.resets" : "format.resetsIn";
    const usageCompact = display?.usageCompact ?? false;
    if (isLimitReached(ctx.usageData)) {
        const resetTime = ctx.usageData.fiveHour === 100
            ? formatResetTime(ctx.usageData.fiveHourResetAt, timeFormat)
            : formatResetTime(ctx.usageData.sevenDayResetAt, timeFormat);
        if (usageCompact) {
            return critical(`⚠ Limit${resetTime ? ` (${resetTime})` : ""}`, colors);
        }
        const resetSuffix = resetTime
            ? showResetLabel
                ? ` (${t(resetsKey)} ${resetTime})`
                : ` (${resetTime})`
            : "";
        return `${usageLabel} ${critical(`⚠ ${t("status.limitReached")}${resetSuffix}`, colors)}`;
    }
    const threshold = display?.usageThreshold ?? 0;
    const fiveHour = ctx.usageData.fiveHour;
    const sevenDay = ctx.usageData.sevenDay;
    const effectiveUsage = Math.max(fiveHour ?? 0, sevenDay ?? 0);
    if (effectiveUsage < threshold) {
        return null;
    }
    const sevenDayThreshold = display?.sevenDayThreshold ?? 80;
    if (usageCompact) {
        const fiveHourPart = fiveHour !== null
            ? formatCompactWindowPart("5h", fiveHour, ctx.usageData.fiveHourResetAt, timeFormat, colors)
            : null;
        const sevenDayPart = (sevenDay !== null && (fiveHour === null || sevenDay >= sevenDayThreshold))
            ? formatCompactWindowPart("7d", sevenDay, ctx.usageData.sevenDayResetAt, timeFormat, colors)
            : null;
        if (fiveHourPart && sevenDayPart) {
            return `${fiveHourPart} | ${sevenDayPart}`;
        }
        return fiveHourPart ?? sevenDayPart ?? null;
    }
    const usageBarEnabled = display?.usageBarEnabled ?? true;
    const barWidth = getAdaptiveBarWidth();
    if (fiveHour === null && sevenDay !== null) {
        const weeklyOnlyPart = formatUsageWindowPart({
            label: t("label.weekly"),
            labelKey: "label.weekly",
            percent: sevenDay,
            resetAt: ctx.usageData.sevenDayResetAt,
            colors,
            usageBarEnabled,
            barWidth,
            timeFormat,
            showResetLabel,
            forceLabel: true,
            alignLabels,
        });
        return `${usageLabel} ${weeklyOnlyPart}`;
    }
    const fiveHourPart = formatUsageWindowPart({
        label: "5h",
        percent: fiveHour,
        resetAt: ctx.usageData.fiveHourResetAt,
        colors,
        usageBarEnabled,
        barWidth,
        timeFormat,
        showResetLabel,
    });
    if (sevenDay !== null && sevenDay >= sevenDayThreshold) {
        const sevenDayPart = formatUsageWindowPart({
            label: t("label.weekly"),
            labelKey: "label.weekly",
            percent: sevenDay,
            resetAt: ctx.usageData.sevenDayResetAt,
            colors,
            usageBarEnabled,
            barWidth,
            timeFormat,
            showResetLabel,
            forceLabel: true,
            alignLabels,
        });
        return `${usageLabel} ${fiveHourPart} | ${sevenDayPart}`;
    }
    return `${usageLabel} ${fiveHourPart}`;
}
function formatCompactWindowPart(windowLabel, percent, resetAt, timeFormat, colors) {
    const usageDisplay = formatUsagePercent(percent, colors);
    const reset = formatResetTime(resetAt, timeFormat);
    const styledLabel = label(`${windowLabel}:`, colors);
    return reset
        ? `${styledLabel} ${usageDisplay} ${label(`(${reset})`, colors)}`
        : `${styledLabel} ${usageDisplay}`;
}
function formatUsagePercent(percent, colors) {
    if (percent === null) {
        return label("--", colors);
    }
    const color = getQuotaColor(percent, colors);
    return `${color}${percent}%${RESET}`;
}
function formatUsageWindowPart({ label: windowLabel, labelKey, percent, resetAt, colors, usageBarEnabled, barWidth, timeFormat = 'relative', showResetLabel, forceLabel = false, alignLabels = false, }) {
    const usageDisplay = formatUsagePercent(percent, colors);
    const reset = formatResetTime(resetAt, timeFormat);
    const styledLabel = labelKey
        ? progressLabel(labelKey, colors, alignLabels)
        : label(windowLabel, colors);
    const resetsKey = timeFormat === 'absolute' ? "format.resets" : "format.resetsIn";
    const resetSuffix = reset
        ? showResetLabel
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
//# sourceMappingURL=usage.js.map