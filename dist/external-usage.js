import * as fs from 'node:fs';
import * as path from 'node:path';
import { createDebug } from './debug.js';
import { sanitizeDisplayText } from './utils/sanitize.js';
const debug = createDebug('external-usage');
export const EXTERNAL_USAGE_WRITE_THROTTLE_MS = 30_000;
const MAX_BALANCE_LABEL_LENGTH = 50;
const SCOPED_WINDOWS_MAX = 8;
const SCOPED_LABEL_MAX_LENGTH = 64;
const fsDeps = fs;
function parseUsagePercent(value) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.min(100, Math.max(0, value))) : null;
}
function parseBalanceLabel(value) {
    const label = typeof value === 'string' ? sanitizeDisplayText(value).trim() : '';
    if (!label)
        return null;
    return label.length <= MAX_BALANCE_LABEL_LENGTH ? label : `${label.slice(0, MAX_BALANCE_LABEL_LENGTH - 3)}...`;
}
// Epoch seconds or milliseconds, or an ISO-8601 string.
function parseDate(value) {
    let date = null;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        date = new Date(value > 1e12 ? value : value * 1000);
    }
    else if (typeof value === 'string' && value.trim()) {
        date = new Date(value);
    }
    return date && !Number.isNaN(date.getTime()) ? date : null;
}
// model_scoped windows ({ display_name, utilization 0-100, resets_at ISO-8601 }). The
// snapshot is untrusted, so entries are bounded and malformed ones dropped.
function parseScopedWindows(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const windows = [];
    for (const entry of value) {
        if (windows.length >= SCOPED_WINDOWS_MAX)
            break;
        const label = typeof entry?.display_name === 'string'
            ? sanitizeDisplayText(entry.display_name).trim().slice(0, SCOPED_LABEL_MAX_LENGTH)
            : '';
        const percent = entry?.utilization === null ? null : parseUsagePercent(entry?.utilization);
        if (!label || (entry?.utilization !== null && percent === null))
            continue;
        const resetAt = typeof entry?.resets_at === 'string' && !Number.isNaN(Date.parse(entry.resets_at))
            ? new Date(entry.resets_at)
            : null;
        windows.push({ label, percent, resetAt });
    }
    return windows;
}
// Rewrite when the values change or the snapshot is older than the throttle, so readers
// can trust updated_at without the file being rewritten on every render.
function shouldWrite(snapshotPath, next, now, deps) {
    try {
        if (now - deps.statSync(snapshotPath).mtimeMs > EXTERNAL_USAGE_WRITE_THROTTLE_MS) {
            return true;
        }
        const { updated_at: _, ...current } = JSON.parse(deps.readFileSync(snapshotPath, 'utf8'));
        const { updated_at: __, ...values } = next;
        return JSON.stringify(current) !== JSON.stringify(values);
    }
    catch {
        return true;
    }
}
// Writes stdin's rate limits for other local tools: an absolute .json path in an existing
// directory, replaced atomically with a private file.
export function writeExternalUsageSnapshot(config, usage, now = Date.now(), deps = fsDeps) {
    const target = config.display.externalUsageWritePath;
    if (!target || !path.isAbsolute(target) || path.extname(target).toLowerCase() !== '.json')
        return false;
    if (!usage || (usage.fiveHour === null && usage.sevenDay === null))
        return false;
    const snapshotPath = path.normalize(target);
    const dir = path.dirname(snapshotPath);
    const snapshot = {
        updated_at: new Date(now).toISOString(),
        five_hour: { used_percentage: usage.fiveHour, resets_at: usage.fiveHourResetAt?.toISOString() ?? null },
        seven_day: { used_percentage: usage.sevenDay, resets_at: usage.sevenDayResetAt?.toISOString() ?? null },
    };
    const tmpPath = path.join(dir, `.${path.basename(snapshotPath)}.${process.pid}.${now}.tmp`);
    try {
        if (!deps.statSync(dir).isDirectory() || !shouldWrite(snapshotPath, snapshot, now, deps)) {
            return false;
        }
        deps.writeFileSync(tmpPath, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        deps.renameSync(tmpPath, snapshotPath);
        deps.chmodSync(snapshotPath, 0o600);
        return true;
    }
    catch (err) {
        debug('Failed to write usage snapshot:', err instanceof Error ? err.message : err);
        try {
            deps.rmSync(tmpPath, { force: true });
        }
        catch {
            // Nothing left to clean up.
        }
        return false;
    }
}
export function getUsageFromExternalSnapshot(config, now = Date.now()) {
    const snapshotPath = config.display.externalUsagePath;
    if (!snapshotPath || !path.isAbsolute(snapshotPath)) {
        return null;
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
        const updatedAt = parseDate(parsed.updated_at)?.getTime();
        if (updatedAt === undefined || now - updatedAt > config.display.externalUsageFreshnessMs) {
            return null;
        }
        const fiveHour = parseUsagePercent(parsed.five_hour?.used_percentage);
        const sevenDay = parseUsagePercent(parsed.seven_day?.used_percentage);
        const balanceLabel = parseBalanceLabel(parsed.balance_label);
        const scopedWindows = parseScopedWindows(parsed.model_scoped);
        if (fiveHour === null && sevenDay === null && balanceLabel === null && scopedWindows.length === 0) {
            return null;
        }
        // A reset time that is present but unreadable means a broken snapshot, not a missing one.
        const fiveHourResetAt = parseDate(parsed.five_hour?.resets_at);
        const sevenDayResetAt = parseDate(parsed.seven_day?.resets_at);
        if ((parsed.five_hour?.resets_at != null && !fiveHourResetAt) || (parsed.seven_day?.resets_at != null && !sevenDayResetAt)) {
            return null;
        }
        return {
            fiveHour,
            sevenDay,
            fiveHourResetAt,
            sevenDayResetAt,
            ...(balanceLabel !== null && { balanceLabel }),
            ...(scopedWindows.length > 0 && { scopedWindows }),
        };
    }
    catch (err) {
        debug('Failed to read external usage snapshot:', err instanceof Error ? err.message : err);
        return null;
    }
}
// Stdin wins. The snapshot fills in what it lacks (the 7-day window for clients that only
// send five_hour, model-scoped windows, a balance label), or stands in when stdin has none.
export function resolveUsage(config, stdinUsage, now = Date.now()) {
    if (!config.display.externalUsagePath) {
        return stdinUsage;
    }
    const external = getUsageFromExternalSnapshot(config, now);
    if (!stdinUsage || !external) {
        return stdinUsage ?? external;
    }
    return {
        ...stdinUsage,
        ...(external.balanceLabel != null && { balanceLabel: external.balanceLabel }),
        ...(stdinUsage.sevenDay == null && external.sevenDay != null && {
            sevenDay: external.sevenDay,
            sevenDayResetAt: external.sevenDayResetAt ?? null,
        }),
        ...(external.scopedWindows && { scopedWindows: external.scopedWindows }),
    };
}
//# sourceMappingURL=external-usage.js.map