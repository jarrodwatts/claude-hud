import * as fs from 'node:fs';
function parseUsagePercent(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }
    return Math.round(Math.min(100, Math.max(0, value)));
}
function parseDateValue(value) {
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || value <= 0) {
            return null;
        }
        const millis = value > 1e12 ? value : value * 1000;
        const date = new Date(millis);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof value === 'string' && value.trim()) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
}
function parseUpdatedAt(value) {
    const date = parseDateValue(value);
    return date ? date.getTime() : null;
}
export function getUsageFromExternalSnapshot(config, now = Date.now()) {
    const snapshotPath = config.display.externalUsagePath;
    if (!snapshotPath) {
        return null;
    }
    try {
        const raw = fs.readFileSync(snapshotPath, 'utf8');
        const parsed = JSON.parse(raw);
        const updatedAt = parseUpdatedAt(parsed.updated_at);
        if (updatedAt === null) {
            return null;
        }
        const freshnessMs = config.display.externalUsageFreshnessMs;
        if (now - updatedAt > freshnessMs) {
            return null;
        }
        const fiveHour = parseUsagePercent(parsed.five_hour?.used_percentage);
        const sevenDay = parseUsagePercent(parsed.seven_day?.used_percentage);
        if (fiveHour === null && sevenDay === null) {
            return null;
        }
        const fiveHourResetAt = parseDateValue(parsed.five_hour?.resets_at);
        const sevenDayResetAt = parseDateValue(parsed.seven_day?.resets_at);
        if (parsed.five_hour && parsed.five_hour.resets_at != null && fiveHourResetAt === null) {
            return null;
        }
        if (parsed.seven_day && parsed.seven_day.resets_at != null && sevenDayResetAt === null) {
            return null;
        }
        return {
            fiveHour,
            sevenDay,
            fiveHourResetAt,
            sevenDayResetAt,
        };
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=external-usage.js.map